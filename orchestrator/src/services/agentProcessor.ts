import type { DbPool } from '../db';
import { getConversation, setConversationState, shouldBotRespond } from './conversation';
import { getBehaviorOverride } from './behaviorOverrides';
import { createHandoffCase, addPendingAction } from './handoff';
import { getLastMessages, persistMessage } from './messageStore';
import { updateLastOutbound } from './conversation';
import { sendWhatsAppMessage } from './whatsappSend';
import { getConfigNumber, getConfigBoolean, getConfigString, getConfig } from '../config';
import { callMcp, createHandoffViaMcp } from './mcpClient';
import { callAiAgent } from './aiAgent';
import { getKbContext, buildKbContextBlock } from './kb';
import { classifyIntent, detectLanguage } from './intent';
import { getDatesToFetch, matchStaffFromMessage } from './bookingContext';
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
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId);
    return;
  }

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
      languageHint
    );
    return;
  }

  const text = batch.map((m) => m.text).join('\n');
  const lower = text.toLowerCase();
  const hasTrigger = HANDOFF_TRIGGERS.some((t) => lower.includes(t));
  if (hasTrigger) {
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId);
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
      const reply = `You have ${appointments.length} upcoming appointment(s). Need to reschedule or cancel? Reply with your request.`;
      await sendAndLog(db, clientPhone, reply, conversationId, logger);
      await sendToSummary(`[${clientPhone}] Replied with appointments summary.`);
    } else {
      const reply = 'Thanks for your message. Our team will get back to you shortly.';
      await sendAndLog(db, clientPhone, reply, conversationId, logger);
      await sendToSummary(`[${clientPhone}] Replied with generic message.`);
    }
  } catch (err) {
    logger.error({ err, conversationId }, 'MCP call failed');
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId);
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
  languageHint: string | null
) {
  const first = batch[0];
  const { conversationId, clientPhone } = first;
  const batchText = batch.map((m) => m.text).join('\n');

  const intent = classifyIntent(batchText);
  const lang = detectLanguage(batchText, languageHint);

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

  let free_slots: string[] = [];
  if ((intent === 'BOOKING' || intent === 'UNKNOWN') && staff.length > 0 && services.length > 0) {
    const staffId = matchStaffFromMessage(batchText, staff) ?? staff[0].id;
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

  if (!result) {
    await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId);
    await sendToSummary(`[${clientPhone}] AI agent call failed → handoff.`);
    return;
  }

  if (result.confidence < AI_CONFIDENCE_THRESHOLD) {
    const summary = result.handoff?.summary || `Low confidence (${result.confidence}); tags: ${(result.tags || []).join(', ') || 'none'}`;
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary);
    await sendToSummary(`[${clientPhone}] Confidence ${result.confidence} < ${AI_CONFIDENCE_THRESHOLD} → handoff.`);
    return;
  }

  if (result.decision === 'HANDOFF') {
    const summary = result.handoff?.summary || result.handoff?.reason || batchText.slice(0, 200);
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary);
    if (result.reply_text) await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
    await sendToSummary(`[${clientPhone}] AI HANDOFF: ${summary.slice(0, 80)}...`);
    return;
  }

  if (result.decision === 'NEED_APPROVAL') {
    const summary = result.handoff?.summary || `Approval requested: ${batchText.slice(0, 150)}`;
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary);
    if (result.reply_text) await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
    await sendToSummary(`[${clientPhone}] NEED_APPROVAL → handoff. ${summary.slice(0, 60)}...`);
    return;
  }

  if (result.decision === 'RESPOND') {
    let createAppointmentFailed = false;
    let createAppointmentSucceeded = false;
    if (Array.isArray(result.mcp_calls) && result.mcp_calls.length > 0) {
      for (const item of result.mcp_calls) {
        const tool = typeof (item as any)?.tool === 'string' ? (item as any).tool : null;
        const payload = (item as any)?.payload && typeof (item as any).payload === 'object' ? (item as any).payload : {};
        if (tool) {
          try {
            await callMcp(tool, payload, companyId, requestId);
            if (tool === 'crm.create_appointment') createAppointmentSucceeded = true;
            logger.info({ tool, conversationId }, 'MCP call from AI executed');
          } catch (err) {
            logger.warn({ err, tool, conversationId }, 'MCP call from AI failed');
            if (tool === 'crm.create_appointment') createAppointmentFailed = true;
          }
        }
      }
    }
    if (createAppointmentFailed) {
      const neutralMsg = 'Leider ist bei der Buchung etwas schiefgelaufen. Ich habe Ihre Anfrage an unser Team weitergeleitet – wir melden uns in Kürze bei Ihnen.';
      await sendAndLog(db, clientPhone, neutralMsg, conversationId, logger);
      await createHandoffAndPauseWithSummary(
        db,
        conversationId,
        clientPhone,
        batch,
        logger,
        sendToSummary,
        requestId,
        'Booking API failed (slot conflict or validation); client needs alternative or manual booking.'
      );
      await sendToSummary(`[${clientPhone}] create_appointment failed → handoff.`);
      return;
    }
    const replyLooksConfirmed = /подтвержден|confirmed|забронирован|booked|подходит|записал|записала/i.test(result.reply_text ?? '');
    if (replyLooksConfirmed && !createAppointmentSucceeded) {
      logger.warn({ conversationId }, 'AI claimed booking confirmed but create_appointment was not executed → escalate');
      const neutralMsg = 'Leider kann ich die Buchung nicht automatisch bestätigen. Ich habe Ihre Anfrage an unser Team weitergeleitet – wir melden uns in Kürze bei Ihnen.';
      await sendAndLog(db, clientPhone, neutralMsg, conversationId, logger);
      await createHandoffAndPauseWithSummary(
        db,
        conversationId,
        clientPhone,
        batch,
        logger,
        sendToSummary,
        requestId,
        'AI replied "confirmed" without successful create_appointment; needs manual booking.'
      );
      await sendToSummary(`[${clientPhone}] Fake confirmation blocked → handoff.`);
      return;
    }
    if (result.reply_text) {
      await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
      await sendToSummary(`[${clientPhone}] AI RESPOND (confidence ${result.confidence}).`);
    } else {
      const fallback = 'Vielen Dank für Ihre Nachricht. Unser Team meldet sich in Kürze bei Ihnen.';
      await sendAndLog(db, clientPhone, fallback, conversationId, logger);
      await sendToSummary(`[${clientPhone}] AI RESPOND but no reply_text → fallback.`);
    }
  }
}

async function createHandoffAndPause(
  db: DbPool,
  conversationId: string,
  clientPhone: string,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  requestId: string
) {
  const summary = `Handoff: ${batch.map((m) => m.text).join(' ').slice(0, 200)}`;
  await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary);
}

async function createHandoffAndPauseWithSummary(
  db: DbPool,
  conversationId: string,
  clientPhone: string,
  batch: QueuedMessage[],
  logger: any,
  sendToSummary: (msg: string) => Promise<void>,
  requestId: string,
  summary: string
) {
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
  const pauseMsg = 'I forwarded your message to our team. They will get back to you as soon as possible.';
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
  await sendToSummary(`[${clientPhone}] Handoff case ${caseId}: ${summary.slice(0, 80)}...`);
}
