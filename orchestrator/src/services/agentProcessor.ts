import type { DbPool } from '../db';
import { getConversation, setConversationState, shouldBotRespond, updateConversationLanguageAndScenario, type ConversationRow } from './conversation';
import { getBehaviorOverride, type BehaviorOverride } from './behaviorOverrides';
import { createHandoffCase, addPendingAction } from './handoff';
import { getLastMessages, persistMessage } from './messageStore';
import { updateLastOutbound } from './conversation';
import { sendWhatsAppMessage } from './whatsappSend';
import { getConfigNumber, getConfigBoolean, getConfigString, getConfig } from '../config';
import { callMcp, createHandoffViaMcp } from './mcpClient';
import { callAiAgent } from './aiAgent';
import { getKbContext, buildKbContextBlock } from './kb';
import { classifyIntent, detectLanguage } from './intent';
import { getSystemMessage, effectiveLangForReply, resolveReplyLanguage, type ResolvedLanguage } from './localization';
import { intentToScenarioCode, isMutatingTool, type ScenarioPolicy } from './scenarioPolicy';
import { appendConversationEvent } from './conversationEvents';
import { getDatesToFetch, matchStaffFromMessage } from './bookingContext';
import { routeScenario } from './scenarioRouter';
import { buildClientContext } from './clientContext';
import { evaluatePolicy } from './policySpecialist';
import { assembleDecisionSkeleton } from './decisionAssembler';
import { evaluateBooking } from './bookingSpecialist';
import { evaluateReschedule } from './rescheduleSpecialist';
import { evaluateCancellation } from './cancellationSpecialist';
import { writeReply } from './writer';
import { runReplyQaGuard } from './replyQaGuard';
import { persistDecisionSnapshot } from './decisionDiagnostics';
import type { DecisionObject, ScenarioCode } from '../types/contracts';
import { prepareHandoff } from './handoffSpecialist';
import { tryDeterministicSchedulingReply } from './deterministicScheduling';
import type { QueuedMessage } from './debounce';

const AI_CONFIDENCE_THRESHOLD = 0.97;

const HANDOFF_TRIGGERS = [
  'cancel',
  'cancellation',
  'payment',
  'discount',
  'complaint',
  'refund',
  'manager',
  'admin'
];

/** Send message via WhatsApp and log to DB (conversation_messages + last_outbound). */
async function sendAndLog(
  db: DbPool,
  clientPhone: string,
  text: string,
  conversationId: string,
  logger: any
) {
  const result = await sendWhatsAppMessage(clientPhone, text, conversationId, logger);
  if (!result.ok) return;
  const ts = new Date();
  await persistMessage(db, {
    conversationId,
    clientPhone,
    ts,
    direction: 'out',
    author: 'agent',
    text,
    messageId: result.provider_message_id ?? undefined
  });
  await updateLastOutbound(db, conversationId);
}

export async function processBatch(
  db: DbPool,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  companyId: number
) {
  if (batch.length === 0) return;
  const first = batch[0];
  const { conversationId, clientPhone } = first;
  const requestId = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  logger.info({ conversationId, clientPhone, batchSize: batch.length }, 'ProcessBatch: starting');

  const conv = await getConversation(db, conversationId);
  if (!conv) {
    logger.warn({ conversationId }, 'ProcessBatch: conversation not found, skip');
    return;
  }
  if (!shouldBotRespond(conv.state)) {
    logger.info({ conversationId, state: conv.state }, 'ProcessBatch: bot should not respond (state), skip');
    return;
  }

  const overrides = await getBehaviorOverride(db, clientPhone);
  if (overrides?.force_handoff) {
    const batchTextForHandoff = batch.map((m) => m.text).join('\n');
    const effectiveLang = resolveReplyLanguage(
      batchTextForHandoff,
      (conv.language_hint as string | null) || null,
      overrides?.language_preference ?? null
    );
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, effectiveLang);
    return;
  }

  const batchText = batch.map((m) => m.text).join('\n');
  const defaultEffectiveLang: ResolvedLanguage = resolveReplyLanguage(
    batchText,
    (conv.language_hint as string | null) || null,
    overrides?.language_preference ?? null
  );

  const apiKey = await getConfigString('OPENAI_API_KEY', '');
  if (apiKey) {
    const tz = await getConfigString('business_hours.timezone', 'Europe/Vienna');
    const start = await getConfigString('business_hours.start', '08:00');
    const end = await getConfigString('business_hours.end', '20:00');
    const languageHint = (conv.language_hint as string | null) || null;
    await processWithAiAgent(
      db,
      batch,
      logger,
      sendToSummary,
      companyId,
      requestId,
      tz,
      start,
      end,
      languageHint,
      overrides?.language_preference ?? null,
      conv,
      overrides ?? null
    );
    return;
  }

  await processWithoutAi(
    db,
    batch,
    logger,
    sendToSummary,
    companyId,
    requestId,
    conv,
    clientPhone,
    batchText,
    defaultEffectiveLang
  );
}

/**
 * Legacy non-AI fallback path used only when no AI API key is configured.
 * Provides simple upcoming-appointments summary or generic reply, or falls back to handoff on MCP error.
 */
async function processWithoutAi(
  db: DbPool,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  companyId: number,
  requestId: string,
  conv: Awaited<ReturnType<typeof getConversation>>,
  clientPhone: string,
  batchText: string,
  defaultEffectiveLang: ResolvedLanguage
) {
  const { conversation_id: conversationId } = conv!;
  const lower = batchText.toLowerCase();
  const hasTrigger = HANDOFF_TRIGGERS.some((t) => lower.includes(t));
  if (hasTrigger) {
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, defaultEffectiveLang);
    return;
  }

  try {
    const mcpRes = await callMcp(
      'admin.get_upcoming_appointments_by_phone',
      { phone: clientPhone, limit: 5 },
      companyId,
      requestId
    );
    const appointments = (mcpRes.result as { appointments?: unknown[] })?.appointments;
    if (mcpRes.decision === 'ALLOW' && appointments?.length) {
      const reply = getSystemMessage('upcoming_appointments', defaultEffectiveLang, { n: appointments.length });
      await sendAndLog(db, clientPhone, reply, conversationId, logger);
      await sendToSummary(`[${clientPhone}] Replied with appointments summary.`);
    } else {
      const reply = getSystemMessage('generic_reply', defaultEffectiveLang);
      await sendAndLog(db, clientPhone, reply, conversationId, logger);
      await sendToSummary(`[${clientPhone}] Replied with generic message.`);
    }
  } catch (err) {
    logger.error({ err, conversationId }, 'MCP call failed');
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, defaultEffectiveLang);
  }
}

async function processWithAiAgent(
  db: DbPool,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  companyId: number,
  requestId: string,
  tz: string,
  start: string,
  end: string,
  languageHint: string | null,
  languagePreference: string | null,
  conv: ConversationRow,
  overrides: BehaviorOverride | null
) {
  const first = batch[0];
  const { conversationId, clientPhone } = first;
  const batchText = batch.map((m) => m.text).join('\n');

  const routed = routeScenario({
    text: batchText,
    languageHint,
    languagePreference
  });
  const intent = routed.intent;
  const lang = routed.languageCode;
  const effectiveLang = routed.effectiveLanguage;
  try {
    await appendConversationEvent(db, conversationId, 'language_detected', { language: effectiveLang, raw: lang });
  } catch (_) {}
  const scenarioCode = intentToScenarioCode(intent) as ScenarioCode;
  try {
    await appendConversationEvent(db, conversationId, 'intent_detected', { intent });
    await appendConversationEvent(db, conversationId, 'scenario_selected', { scenario_code: scenarioCode });
  } catch (_) {}
  let policy: ScenarioPolicy | null = null;
  let safePolicy: ScenarioPolicy;
  let policyResult;
  try {
    const { safePolicy: sp, result } = await evaluatePolicy(db, scenarioCode as any);
    safePolicy = sp;
    policyResult = result;
    policy = result.policy;
  } catch (_) {
    safePolicy = {
      scenario_id: 0,
      scenario_code: scenarioCode,
      autonomy_mode: 'ASSIST_ONLY',
      allow_agent_to_reply: true,
      allow_agent_to_execute: false,
      allow_agent_to_create_handoff: true,
      requires_admin_approval: true,
      confidence_threshold: AI_CONFIDENCE_THRESHOLD,
      max_attempts_before_handoff: null,
      config_json: null
    };
    policyResult = {
      scenarioCode: scenarioCode as any,
      policy: null,
      permissions: {
        canReply: safePolicy.allow_agent_to_reply,
        canExecuteMutating: safePolicy.allow_agent_to_execute,
        canCreateHandoff: safePolicy.allow_agent_to_create_handoff,
        requiresAdminApproval: safePolicy.requires_admin_approval,
        confidenceThreshold: Math.max(AI_CONFIDENCE_THRESHOLD, safePolicy.confidence_threshold)
      }
    };
  }
  if (policy) {
    try {
      await appendConversationEvent(db, conversationId, 'policy_applied', {
        scenario_code: policy.scenario_code,
        allow_agent_to_reply: policy.allow_agent_to_reply,
        allow_agent_to_execute: policy.allow_agent_to_execute,
        allow_agent_to_create_handoff: policy.allow_agent_to_create_handoff
      });
    } catch (_) {}
  }
  try {
    await updateConversationLanguageAndScenario(db, conversationId, effectiveLang, scenarioCode);
  } catch (_) {}

  let appointments: Array<{ id?: string; start?: string; service?: string; master?: string }> = [];
  let services: Array<{ id: number; name?: string }> = [];
  let staff: Array<{ id: number; name?: string }> = [];
  try {
    const mcpRes = await callMcp(
      'admin.get_upcoming_appointments_by_phone',
      { phone: clientPhone, limit: 5 },
      companyId,
      requestId
    );
    const list = (mcpRes.result as { appointments?: unknown[] })?.appointments;
    if (Array.isArray(list)) {
      appointments = list as Array<{ id?: string; start?: string; service?: string; master?: string }>;
    }
  } catch (_) {}
  try {
    const svcRes = await callMcp('crm.list_services', { company_id: companyId }, companyId, requestId);
    const list = (svcRes.result as { services?: unknown[] })?.services;
    if (Array.isArray(list)) {
      services = list.map((s: any) => ({ id: Number(s?.id ?? s), name: s?.name ?? s?.title ?? '' })).filter((s) => Number.isFinite(s.id));
    }
  } catch (_) {}
  let kbText: string | undefined;
  try {
    const templatesLimit = await getConfigNumber('KB_CONTEXT_LIMIT_TEMPLATES', 3);
    const goodLimit = await getConfigNumber('KB_CONTEXT_LIMIT_GOOD_EXAMPLES', 3);
    const badLimit = await getConfigNumber('KB_CONTEXT_LIMIT_BAD_EXAMPLES', 1);
    const kb = await getKbContext(db, {
      intent,
      language: lang,
      phone: clientPhone,
      messageText: batchText,
      limits: {
        templates: templatesLimit,
        goodExamples: goodLimit,
        badExamples: badLimit
      }
    });
    const maxChars = await getConfigNumber('KB_CONTEXT_MAX_CHARS', 2500);
    kbText = buildKbContextBlock(kb, maxChars);
  } catch (err) {
    logger.warn({ err, conversationId, clientPhone }, 'KB context fetch failed, continuing without KB');
  }
  try {
    const staffRes = await callMcp('crm.list_staff', { company_id: companyId }, companyId, requestId);
    const list = (staffRes.result as { staff?: unknown[] })?.staff;
    if (Array.isArray(list)) {
      staff = list.map((s: any) => ({ id: Number(s?.id ?? s), name: s?.name ?? s?.full_name ?? '' })).filter((s) => Number.isFinite(s.id));
    }
  } catch (_) {}

  if (intent === 'BOOKING' || intent === 'UNKNOWN') {
    const detResult = await tryDeterministicSchedulingReply({
      batchText,
      companyId,
      requestId,
      effectiveLang,
      timezone: tz
    });
    if (detResult.applied) {
      for (const ev of detResult.events) {
        try {
          await appendConversationEvent(db, conversationId, ev.event_type, ev.payload);
        } catch (_) {}
      }
      await sendAndLog(db, clientPhone, detResult.reply, conversationId, logger);
      await sendToSummary(`[${clientPhone}] Deterministic scheduling reply (${detResult.code}), no handoff.`);
      return;
    }
  }

  let free_slots: string[] = [];
  if ((intent === 'BOOKING' || intent === 'UNKNOWN') && staff.length > 0 && services.length > 0) {
    // Try to respect preferred master based on upcoming appointments, then fall back to staff mentioned in text, then first staff.
    let preferredStaffId: number | undefined;
    if (appointments.length > 0) {
      const lastAppt = appointments[0];
      const masterName = (lastAppt.master ?? '').toString().trim().toLowerCase();
      if (masterName) {
        const matched = staff.find((s) => (s.name ?? '').toLowerCase().includes(masterName));
        if (matched) preferredStaffId = matched.id;
      }
    }
    const staffId = matchStaffFromMessage(batchText, staff) ?? preferredStaffId ?? staff[0].id;
    const datesToFetch = getDatesToFetch(batchText);
    for (const date of datesToFetch) {
      try {
        const res = await callMcp(
          'crm.get_free_slots',
          { company_id: companyId, staff_id: staffId, service_id: services[0].id, date },
          companyId,
          requestId
        );
        const slots = (res.result as { free_slots?: string[] })?.free_slots;
        if (Array.isArray(slots)) free_slots = free_slots.concat(slots);
      } catch (_) {}
    }
  }

  const rows = await getLastMessages(db, conversationId, 20);
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = rows.map((m) => ({
    role: m.direction === 'in' || m.author === 'client' ? ('user' as const) : ('assistant' as const),
    content: m.direction === 'in' || m.author === 'client' ? `Client: ${m.text}` : m.text
  }));
  conversationHistory.push({ role: 'user', content: `Client wrote: ${batchText}` });

  const apiKey = await getConfigString('OPENAI_API_KEY', '');
  const apiBaseUrl = await getConfigString('AI_AGENT_API_BASE_URL', '');
  const model = await getConfigString('AI_AGENT_MODEL', 'gpt-4o-mini');

  const result = await callAiAgent(
    apiKey,
    apiBaseUrl || undefined,
    model,
    conversationHistory,
    {
      appointments: appointments.length ? appointments : undefined,
      businessHours: { timezone: tz, start, end },
      company_id: companyId,
      services: services.length ? services : undefined,
      staff: staff.length ? staff : undefined,
      client_phone_e164: clientPhone,
      kb_text: kbText,
      free_slots: free_slots.length ? free_slots : undefined
    },
    logger
  );

  // Build DecisionObject skeleton for diagnostics / enrichment (no behaviour change for now).
  let decisionSkeleton: DecisionObject | null = null;
  try {
    const bookingResult =
      intent === 'BOOKING'
        ? evaluateBooking({
            intent,
            deterministic: undefined,
            freeSlots: free_slots
          })
        : undefined;

    const rescheduleResult =
      intent === 'RESCHEDULE'
        ? evaluateReschedule({
            intent,
            upcomingAppointments: appointments,
            freeSlots: free_slots,
            policyAllowsExecute: policyResult.permissions.canExecuteMutating
          })
        : undefined;

    const cancellationResult =
      intent === 'CANCEL_REQUEST'
        ? evaluateCancellation({
            intent,
            upcomingAppointments: appointments,
            requiresAdminApproval: policyResult.permissions.requiresAdminApproval,
            canExecuteMutating: policyResult.permissions.canExecuteMutating
          })
        : undefined;

    const clientContext = buildClientContext({
      phoneE164: clientPhone,
      conversation: conv,
      lastMessages: rows,
      behaviorOverride: overrides,
      detectedLanguage: effectiveLang,
      languageHint,
      kbContextSummary: kbText,
      upcomingAppointments: appointments
    });
    decisionSkeleton = assembleDecisionSkeleton({
      scenario: routed,
      context: clientContext,
      policy: policyResult,
      fallbackLanguage: effectiveLang,
      bookingResult,
      rescheduleResult,
      cancellationResult
    });
    logger.debug?.({ conversationId, decisionSkeleton }, 'Decision skeleton built');
  } catch (_) {
    // Best-effort only; failures here must not affect runtime behaviour.
  }

  if (!result) {
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, 'AI agent call failed', effectiveLang, { reason_code: 'ai_agent_failed' });
    await sendToSummary(`[${clientPhone}] AI agent call failed → handoff.`);
    return;
  }

  const confidenceThreshold = Math.max(AI_CONFIDENCE_THRESHOLD, safePolicy.confidence_threshold);
  if (result.confidence < confidenceThreshold) {
    const summary = result.handoff?.summary || `Low confidence (${result.confidence}); tags: ${(result.tags || []).join(', ') || 'none'}`;
    const ctx: HandoffContext = {
      reason_code: 'low_confidence',
      confidence: result.confidence,
      decision: result.decision,
      reply_text_preview: result.reply_text ?? undefined,
      tags: result.tags ?? undefined
    };
    try {
      const handoffPrep = prepareHandoff({
        scenarioCode,
        reasonCode: 'low_confidence',
        confidence: result.confidence,
        summary,
        replyPreview: result.reply_text ?? undefined,
        tags: result.tags ?? undefined
      });
      logger.debug?.({ conversationId, handoffPrep }, 'Handoff specialist output (low_confidence)');
      if (decisionSkeleton) {
        decisionSkeleton.actionPlan.handoff = handoffPrep;
        decisionSkeleton.outcome = {
          type: 'HANDOFF',
          reasonCode: 'handoff_requested_by_ai',
          confidence: result.confidence
        };
      }
    } catch (_) {
      // diagnostics only
    }
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, ctx);
    if (decisionSkeleton) {
      await persistDecisionSnapshot(db, conversationId, decisionSkeleton);
    }
    return;
  }

  if (result.decision === 'HANDOFF') {
    if (!safePolicy.allow_agent_to_create_handoff) {
      if (safePolicy.allow_agent_to_reply && result.reply_text) await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
      else await sendAndLog(db, clientPhone, getSystemMessage('generic_ack', effectiveLang), conversationId, logger);
      await sendToSummary(`[${clientPhone}] AI HANDOFF but policy disallows handoff → reply only.`);
      return;
    }
    const summary = result.handoff?.summary || result.handoff?.reason || batchText.slice(0, 200);
    const ctx: HandoffContext = {
      reason_code: 'ai_handoff',
      confidence: result.confidence,
      decision: 'HANDOFF',
      reply_text_preview: result.reply_text ?? undefined,
      tags: result.tags ?? undefined
    };
    try {
      const handoffPrep = prepareHandoff({
        scenarioCode,
        reasonCode: 'ai_handoff',
        confidence: result.confidence,
        summary,
        replyPreview: result.reply_text ?? undefined,
        tags: result.tags ?? undefined
      });
      logger.debug?.({ conversationId, handoffPrep }, 'Handoff specialist output (AI HANDOFF)');
      if (decisionSkeleton) {
        decisionSkeleton.actionPlan.handoff = handoffPrep;
        decisionSkeleton.outcome = {
          type: 'HANDOFF',
          reasonCode: 'handoff_requested_by_ai',
          confidence: result.confidence
        };
      }
    } catch (_) {
      // diagnostics only
    }
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, ctx);
    if (decisionSkeleton) {
      await persistDecisionSnapshot(db, conversationId, decisionSkeleton);
    }
    if (result.reply_text) await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
    return;
  }

  if (result.decision === 'NEED_APPROVAL') {
    if (!safePolicy.allow_agent_to_create_handoff) {
      if (safePolicy.allow_agent_to_reply && result.reply_text) await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
      else await sendAndLog(db, clientPhone, getSystemMessage('generic_ack', effectiveLang), conversationId, logger);
      await sendToSummary(`[${clientPhone}] NEED_APPROVAL but policy disallows handoff → reply only.`);
      return;
    }
    const summary = result.handoff?.summary || `Approval requested: ${batchText.slice(0, 150)}`;
    const ctx: HandoffContext = {
      reason_code: 'need_approval',
      confidence: result.confidence,
      decision: 'NEED_APPROVAL',
      reply_text_preview: result.reply_text ?? undefined,
      tags: result.tags ?? undefined
    };
    try {
      const handoffPrep = prepareHandoff({
        scenarioCode,
        reasonCode: 'need_approval',
        confidence: result.confidence,
        summary,
        replyPreview: result.reply_text ?? undefined,
        tags: result.tags ?? undefined
      });
      logger.debug?.({ conversationId, handoffPrep }, 'Handoff specialist output (NEED_APPROVAL)');
      if (decisionSkeleton) {
        decisionSkeleton.actionPlan.handoff = handoffPrep;
        decisionSkeleton.outcome = {
          type: 'NEED_APPROVAL',
          reasonCode: 'handoff_need_approval',
          confidence: result.confidence
        };
      }
    } catch (_) {
      // diagnostics only
    }
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, ctx);
    if (decisionSkeleton) {
      await persistDecisionSnapshot(db, conversationId, decisionSkeleton);
    }
    if (result.reply_text) await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
    return;
  }

  if (result.decision === 'RESPOND') {
    let createAppointmentFailed = false;
    let createAppointmentSucceeded = false;
    const executionItems: {
      tool: string;
      payload: Record<string, unknown>;
      mutating: boolean;
      status?: 'planned' | 'executed' | 'skipped' | 'failed';
      note?: string;
    }[] = [];
    if (Array.isArray(result.mcp_calls) && result.mcp_calls.length > 0) {
      for (const item of result.mcp_calls) {
        const tool = typeof (item as any)?.tool === 'string' ? (item as any).tool : null;
        const payload = (item as any)?.payload && typeof (item as any).payload === 'object' ? (item as any).payload : {};
        if (!tool) continue;
        const mutating = isMutatingTool(tool);
        const execItemBase = {
          tool,
          payload: payload as Record<string, unknown>,
          mutating
        };
        if (isMutatingTool(tool) && !safePolicy.allow_agent_to_execute) {
          logger.info({ tool, conversationId, scenarioCode: safePolicy.scenario_code }, 'MCP mutating tool skipped by policy (allow_agent_to_execute=false)');
          try {
            await appendConversationEvent(db, conversationId, 'execution_denied_by_policy', { tool, reason: 'allow_agent_to_execute=false' });
          } catch (_) {}
          if (tool === 'crm.create_appointment') createAppointmentFailed = true;
          if (decisionSkeleton) {
            executionItems.push({
              ...execItemBase,
              status: 'skipped',
              note: 'allow_agent_to_execute=false'
            });
          }
          continue;
        }
        try {
          await appendConversationEvent(db, conversationId, 'tool_called', { tool });
        } catch (_) {}
        try {
          await callMcp(tool, payload, companyId, requestId);
          if (tool === 'crm.create_appointment') createAppointmentSucceeded = true;
          logger.info({ tool, conversationId }, 'MCP call from AI executed');
          try {
            await appendConversationEvent(db, conversationId, 'tool_succeeded', { tool });
          } catch (_) {}
          if (decisionSkeleton) {
            executionItems.push({
              ...execItemBase,
              status: 'executed'
            });
          }
        } catch (err) {
          logger.warn({ err, tool, conversationId }, 'MCP call from AI failed');
          try {
            await appendConversationEvent(db, conversationId, 'tool_failed', { tool, error: String((err as Error)?.message ?? err) });
          } catch (_) {}
          if (tool === 'crm.create_appointment') createAppointmentFailed = true;
          if (decisionSkeleton) {
            executionItems.push({
              ...execItemBase,
              status: 'failed',
              note: String((err as Error)?.message ?? err)
            });
          }
        }
      }
    }
    if (createAppointmentFailed) {
      const neutralMsg = getSystemMessage('booking_failed', effectiveLang);
      await sendAndLog(db, clientPhone, neutralMsg, conversationId, logger);
      await createHandoffAndPauseWithSummary(
        db,
        conversationId,
        clientPhone,
        batch,
        logger,
        sendToSummary,
        requestId,
        'Booking API failed (slot conflict or validation); client needs alternative or manual booking.',
        effectiveLang,
        { reason_code: 'booking_failed', reply_text_preview: result.reply_text ?? undefined }
      );
      await sendToSummary(`[${clientPhone}] create_appointment failed → handoff.`);
      return;
    }
    const replyLooksConfirmed = /подтвержден|confirmed|забронирован|booked|подходит|записал|записала/i.test(result.reply_text ?? '');
    if (replyLooksConfirmed && !createAppointmentSucceeded) {
      logger.warn({ conversationId }, 'AI claimed booking confirmed but create_appointment was not executed → escalate');
      const neutralMsg = getSystemMessage('booking_not_confirmed_fallback', effectiveLang);
      await sendAndLog(db, clientPhone, neutralMsg, conversationId, logger);
      await createHandoffAndPauseWithSummary(
        db,
        conversationId,
        clientPhone,
        batch,
        logger,
        sendToSummary,
        requestId,
        'AI replied "confirmed" without successful create_appointment; needs manual booking.',
        effectiveLang,
        { reason_code: 'fake_confirmation_blocked', reply_text_preview: result.reply_text ?? undefined }
      );
      await sendToSummary(`[${clientPhone}] Fake confirmation blocked → handoff.`);
      return;
    }
    const writerOutput = writeReply({
      scenarioCode,
      language: effectiveLang,
      replyCandidate: result.reply_text ?? null,
      allowAgentToReply: safePolicy.allow_agent_to_reply
    });
    const qaResult = runReplyQaGuard({
      scenarioCode,
      language: effectiveLang,
      text: writerOutput.text,
      writerUsedFallback: writerOutput.usedFallback,
      allowAgentToReply: safePolicy.allow_agent_to_reply,
      bookingToolSucceeded: createAppointmentSucceeded,
      replyLooksConfirmed
    });
    const replyToSend = qaResult.finalText;
    if (decisionSkeleton) {
      decisionSkeleton.actionPlan.reply = {
        text: replyToSend,
        language: effectiveLang
      };
      if (executionItems.length > 0) {
        decisionSkeleton.actionPlan.execution = {
          mcpCalls: executionItems
        };
      }
      decisionSkeleton.writer = {
        usedFallback: writerOutput.usedFallback
      };
      decisionSkeleton.replyQa = {
        fallbackUsed: qaResult.fallbackUsed,
        issues: qaResult.issues.map((i) => ({ code: i.code }))
      };
      decisionSkeleton.outcome = {
        type: 'RESPOND',
        reasonCode: 'ok',
        confidence: result.confidence
      };
      logger.debug?.({ conversationId, decisionSkeleton }, 'Decision object enriched with reply/writer/qa');
    }
    if (!safePolicy.allow_agent_to_reply) {
      try {
        await appendConversationEvent(db, conversationId, 'reply_blocked', { reason: 'allow_agent_to_reply=false' });
      } catch (_) {}
    }
    try {
      await appendConversationEvent(db, conversationId, 'reply_sent', { length: replyToSend.length });
    } catch (_) {}
    await sendAndLog(db, clientPhone, replyToSend, conversationId, logger);
    if (decisionSkeleton) {
      await persistDecisionSnapshot(db, conversationId, decisionSkeleton);
    }
    await sendToSummary(
      `[${clientPhone}] AI RESPOND (confidence ${result.confidence}) writer_used_fallback=${writerOutput.usedFallback} qa_fallback_used=${qaResult.fallbackUsed} qa_issues=${qaResult.issues
        .map((i) => i.code)
        .join(',') || 'none'}.`
    );
  }
}

/** Context for why handoff happened (for audit and Telegram). */
export interface HandoffContext {
  reason_code: string;
  confidence?: number;
  decision?: string;
  reply_text_preview?: string;
  tags?: string[];
}

async function createHandoffAndPause(
  db: DbPool,
  conversationId: string,
  clientPhone: string,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  requestId: string,
  effectiveLang: ResolvedLanguage
) {
  const summary = `Handoff: ${batch.map((m) => m.text).join(' ').slice(0, 200)}`;
  await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, { reason_code: 'legacy_handoff' });
}

async function createHandoffAndPauseWithSummary(
  db: DbPool,
  conversationId: string,
  clientPhone: string,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  requestId: string,
  summary: string,
  effectiveLang: ResolvedLanguage,
  handoffContext?: HandoffContext
) {
  const payload: Record<string, unknown> = { summary: summary.slice(0, 500) };
  if (handoffContext) {
    payload.reason_code = handoffContext.reason_code;
    if (handoffContext.confidence != null) payload.confidence = handoffContext.confidence;
    if (handoffContext.decision) payload.decision = handoffContext.decision;
    if (handoffContext.reply_text_preview) payload.reply_text_preview = handoffContext.reply_text_preview.slice(0, 300);
    if (handoffContext.tags?.length) payload.tags = handoffContext.tags;
  }
  try {
    await appendConversationEvent(db, conversationId, 'handoff_created', payload);
  } catch (_) {}
  const companyId = Number(await getConfig('DEFAULT_COMPANY_ID')) || 1169276;
  const questionToAdmin = 'Please handle this conversation.';
  const lastMessages = (await getLastMessages(db, conversationId, 10)).map((m) => ({
    ts: m.ts,
    from: m.author as 'client' | 'agent',
    text: m.text
  }));
  const caseId = await createHandoffCase(db, {
    conversationId,
    clientPhone,
    summary,
    questionToAdmin
  });
  await addPendingAction(db, {
    type: 'HANDOFF',
    conversationId,
    clientPhone,
    caseId
  });
  await setConversationState(db, conversationId, 'AWAITING_ADMIN');
  const pauseMsg = getSystemMessage('handoff_ack', effectiveLang);
  await sendAndLog(db, clientPhone, pauseMsg, conversationId, logger);
  try {
    await createHandoffViaMcp(
      conversationId,
      clientPhone,
      summary,
      questionToAdmin,
      lastMessages,
      companyId,
      requestId
    );
  } catch (_) {}
  let telegramLine = `[${clientPhone}] Handoff case ${caseId}: ${summary.slice(0, 80)}...`;
  if (handoffContext) {
    telegramLine += `\nПричина: ${handoffContext.reason_code}`;
    if (handoffContext.confidence != null) telegramLine += ` | уверенность: ${handoffContext.confidence}`;
    if (handoffContext.decision) telegramLine += ` | решение ИИ: ${handoffContext.decision}`;
    if (handoffContext.reply_text_preview) telegramLine += `\nОтвет ИИ (не отправлен): ${handoffContext.reply_text_preview.slice(0, 150)}...`;
    if (handoffContext.tags?.length) telegramLine += `\nТеги: ${handoffContext.tags.join(', ')}`;
  }
  await sendToSummary(telegramLine);
}
