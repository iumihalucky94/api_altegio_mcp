"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processBatch = processBatch;
const conversation_1 = require("./conversation");
const behaviorOverrides_1 = require("./behaviorOverrides");
const handoff_1 = require("./handoff");
const messageStore_1 = require("./messageStore");
const conversation_2 = require("./conversation");
const whatsappSend_1 = require("./whatsappSend");
const config_1 = require("../config");
const mcpClient_1 = require("./mcpClient");
const aiAgent_1 = require("./aiAgent");
const kb_1 = require("./kb");
const localization_1 = require("./localization");
const scenarioPolicy_1 = require("./scenarioPolicy");
const conversationEvents_1 = require("./conversationEvents");
const bookingContext_1 = require("./bookingContext");
const scenarioRouter_1 = require("./scenarioRouter");
const clientContext_1 = require("./clientContext");
const policySpecialist_1 = require("./policySpecialist");
const decisionAssembler_1 = require("./decisionAssembler");
const bookingSpecialist_1 = require("./bookingSpecialist");
const rescheduleSpecialist_1 = require("./rescheduleSpecialist");
const cancellationSpecialist_1 = require("./cancellationSpecialist");
const writer_1 = require("./writer");
const replyQaGuard_1 = require("./replyQaGuard");
const decisionDiagnostics_1 = require("./decisionDiagnostics");
const handoffSpecialist_1 = require("./handoffSpecialist");
const deterministicScheduling_1 = require("./deterministicScheduling");
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
async function sendAndLog(db, clientPhone, text, conversationId, logger) {
    const result = await (0, whatsappSend_1.sendWhatsAppMessage)(clientPhone, text, conversationId, logger);
    if (!result.ok)
        return;
    const ts = new Date();
    await (0, messageStore_1.persistMessage)(db, {
        conversationId,
        clientPhone,
        ts,
        direction: 'out',
        author: 'agent',
        text,
        messageId: result.provider_message_id ?? undefined
    });
    await (0, conversation_2.updateLastOutbound)(db, conversationId);
}
async function processBatch(db, batch, logger, sendToSummary, companyId) {
    if (batch.length === 0)
        return;
    const first = batch[0];
    const { conversationId, clientPhone } = first;
    const requestId = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    logger.info({ conversationId, clientPhone, batchSize: batch.length }, 'ProcessBatch: starting');
    const conv = await (0, conversation_1.getConversation)(db, conversationId);
    if (!conv) {
        logger.warn({ conversationId }, 'ProcessBatch: conversation not found, skip');
        return;
    }
    if (!(0, conversation_1.shouldBotRespond)(conv.state)) {
        logger.info({ conversationId, state: conv.state }, 'ProcessBatch: bot should not respond (state), skip');
        return;
    }
    const overrides = await (0, behaviorOverrides_1.getBehaviorOverride)(db, clientPhone);
    if (overrides?.force_handoff) {
        const batchTextForHandoff = batch.map((m) => m.text).join('\n');
        const effectiveLang = (0, localization_1.resolveReplyLanguage)(batchTextForHandoff, conv.language_hint || null, overrides?.language_preference ?? null);
        await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, effectiveLang);
        return;
    }
    const batchText = batch.map((m) => m.text).join('\n');
    const defaultEffectiveLang = (0, localization_1.resolveReplyLanguage)(batchText, conv.language_hint || null, overrides?.language_preference ?? null);
    const apiKey = await (0, config_1.getConfigString)('OPENAI_API_KEY', '');
    if (apiKey) {
        const tz = await (0, config_1.getConfigString)('business_hours.timezone', 'Europe/Vienna');
        const start = await (0, config_1.getConfigString)('business_hours.start', '08:00');
        const end = await (0, config_1.getConfigString)('business_hours.end', '20:00');
        const languageHint = conv.language_hint || null;
        await processWithAiAgent(db, batch, logger, sendToSummary, companyId, requestId, tz, start, end, languageHint, overrides?.language_preference ?? null, conv, overrides ?? null);
        return;
    }
    await processWithoutAi(db, batch, logger, sendToSummary, companyId, requestId, conv, clientPhone, batchText, defaultEffectiveLang);
}
/**
 * Legacy non-AI fallback path used only when no AI API key is configured.
 * Provides simple upcoming-appointments summary or generic reply, or falls back to handoff on MCP error.
 */
async function processWithoutAi(db, batch, logger, sendToSummary, companyId, requestId, conv, clientPhone, batchText, defaultEffectiveLang) {
    const { conversation_id: conversationId } = conv;
    const lower = batchText.toLowerCase();
    const hasTrigger = HANDOFF_TRIGGERS.some((t) => lower.includes(t));
    if (hasTrigger) {
        await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, defaultEffectiveLang);
        return;
    }
    try {
        const mcpRes = await (0, mcpClient_1.callMcp)('admin.get_upcoming_appointments_by_phone', { phone: clientPhone, limit: 5 }, companyId, requestId);
        const appointments = mcpRes.result?.appointments;
        if (mcpRes.decision === 'ALLOW' && appointments?.length) {
            const reply = (0, localization_1.getSystemMessage)('upcoming_appointments', defaultEffectiveLang, { n: appointments.length });
            await sendAndLog(db, clientPhone, reply, conversationId, logger);
            await sendToSummary(`[${clientPhone}] Replied with appointments summary.`);
        }
        else {
            const reply = (0, localization_1.getSystemMessage)('generic_reply', defaultEffectiveLang);
            await sendAndLog(db, clientPhone, reply, conversationId, logger);
            await sendToSummary(`[${clientPhone}] Replied with generic message.`);
        }
    }
    catch (err) {
        logger.error({ err, conversationId }, 'MCP call failed');
        await createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, defaultEffectiveLang);
    }
}
async function processWithAiAgent(db, batch, logger, sendToSummary, companyId, requestId, tz, start, end, languageHint, languagePreference, conv, overrides) {
    const first = batch[0];
    const { conversationId, clientPhone } = first;
    const batchText = batch.map((m) => m.text).join('\n');
    const routed = (0, scenarioRouter_1.routeScenario)({
        text: batchText,
        languageHint,
        languagePreference
    });
    const intent = routed.intent;
    const lang = routed.languageCode;
    const effectiveLang = routed.effectiveLanguage;
    try {
        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'language_detected', { language: effectiveLang, raw: lang });
    }
    catch (_) { }
    const scenarioCode = (0, scenarioPolicy_1.intentToScenarioCode)(intent);
    try {
        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'intent_detected', { intent });
        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'scenario_selected', { scenario_code: scenarioCode });
    }
    catch (_) { }
    let policy = null;
    let safePolicy;
    let policyResult;
    try {
        const { safePolicy: sp, result } = await (0, policySpecialist_1.evaluatePolicy)(db, scenarioCode);
        safePolicy = sp;
        policyResult = result;
        policy = result.policy;
    }
    catch (_) {
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
            scenarioCode: scenarioCode,
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
            await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'policy_applied', {
                scenario_code: policy.scenario_code,
                allow_agent_to_reply: policy.allow_agent_to_reply,
                allow_agent_to_execute: policy.allow_agent_to_execute,
                allow_agent_to_create_handoff: policy.allow_agent_to_create_handoff
            });
        }
        catch (_) { }
    }
    try {
        await (0, conversation_1.updateConversationLanguageAndScenario)(db, conversationId, effectiveLang, scenarioCode);
    }
    catch (_) { }
    let appointments = [];
    let services = [];
    let staff = [];
    try {
        const mcpRes = await (0, mcpClient_1.callMcp)('admin.get_upcoming_appointments_by_phone', { phone: clientPhone, limit: 5 }, companyId, requestId);
        const list = mcpRes.result?.appointments;
        if (Array.isArray(list)) {
            appointments = list;
        }
    }
    catch (_) { }
    try {
        const svcRes = await (0, mcpClient_1.callMcp)('crm.list_services', { company_id: companyId }, companyId, requestId);
        const list = svcRes.result?.services;
        if (Array.isArray(list)) {
            services = list.map((s) => ({ id: Number(s?.id ?? s), name: s?.name ?? s?.title ?? '' })).filter((s) => Number.isFinite(s.id));
        }
    }
    catch (_) { }
    let kbText;
    try {
        const templatesLimit = await (0, config_1.getConfigNumber)('KB_CONTEXT_LIMIT_TEMPLATES', 3);
        const goodLimit = await (0, config_1.getConfigNumber)('KB_CONTEXT_LIMIT_GOOD_EXAMPLES', 3);
        const badLimit = await (0, config_1.getConfigNumber)('KB_CONTEXT_LIMIT_BAD_EXAMPLES', 1);
        const kb = await (0, kb_1.getKbContext)(db, {
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
        const maxChars = await (0, config_1.getConfigNumber)('KB_CONTEXT_MAX_CHARS', 2500);
        kbText = (0, kb_1.buildKbContextBlock)(kb, maxChars);
    }
    catch (err) {
        logger.warn({ err, conversationId, clientPhone }, 'KB context fetch failed, continuing without KB');
    }
    try {
        const staffRes = await (0, mcpClient_1.callMcp)('crm.list_staff', { company_id: companyId }, companyId, requestId);
        const list = staffRes.result?.staff;
        if (Array.isArray(list)) {
            staff = list.map((s) => ({ id: Number(s?.id ?? s), name: s?.name ?? s?.full_name ?? '' })).filter((s) => Number.isFinite(s.id));
        }
    }
    catch (_) { }
    if (intent === 'BOOKING' || intent === 'UNKNOWN') {
        let preferredStaffName;
        if (appointments.length > 0 && staff.length > 0) {
            const masterName = (appointments[0].master ?? '').toString().trim().toLowerCase();
            if (masterName) {
                const matched = staff.find((s) => (s.name ?? '').toLowerCase().includes(masterName));
                if (matched?.name)
                    preferredStaffName = matched.name;
            }
        }
        const detResult = await (0, deterministicScheduling_1.tryDeterministicSchedulingReply)({
            batchText,
            companyId,
            requestId,
            effectiveLang,
            timezone: tz,
            preferredStaffName
        });
        if (detResult.applied) {
            for (const ev of detResult.events) {
                try {
                    await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, ev.event_type, ev.payload);
                }
                catch (_) { }
            }
            await sendAndLog(db, clientPhone, detResult.reply, conversationId, logger);
            await sendToSummary(`[${clientPhone}] Deterministic scheduling reply (${detResult.code}), no handoff.`);
            return;
        }
    }
    let free_slots = [];
    if ((intent === 'BOOKING' || intent === 'UNKNOWN') && staff.length > 0 && services.length > 0) {
        // Try to respect preferred master based on upcoming appointments, then fall back to staff mentioned in text, then first staff.
        let preferredStaffId;
        if (appointments.length > 0) {
            const lastAppt = appointments[0];
            const masterName = (lastAppt.master ?? '').toString().trim().toLowerCase();
            if (masterName) {
                const matched = staff.find((s) => (s.name ?? '').toLowerCase().includes(masterName));
                if (matched)
                    preferredStaffId = matched.id;
            }
        }
        const staffId = (0, bookingContext_1.matchStaffFromMessage)(batchText, staff) ?? preferredStaffId ?? staff[0].id;
        const datesToFetch = (0, bookingContext_1.getDatesToFetch)(batchText);
        for (const date of datesToFetch) {
            try {
                const res = await (0, mcpClient_1.callMcp)('crm.get_free_slots', { company_id: companyId, staff_id: staffId, service_id: services[0].id, date }, companyId, requestId);
                const slots = res.result?.free_slots;
                if (Array.isArray(slots))
                    free_slots = free_slots.concat(slots);
            }
            catch (_) { }
        }
    }
    const rows = await (0, messageStore_1.getLastMessages)(db, conversationId, 20);
    const conversationHistory = rows.map((m) => ({
        role: m.direction === 'in' || m.author === 'client' ? 'user' : 'assistant',
        content: m.direction === 'in' || m.author === 'client' ? `Client: ${m.text}` : m.text
    }));
    conversationHistory.push({ role: 'user', content: `Client wrote: ${batchText}` });
    const apiKey = await (0, config_1.getConfigString)('OPENAI_API_KEY', '');
    const apiBaseUrl = await (0, config_1.getConfigString)('AI_AGENT_API_BASE_URL', '');
    const model = await (0, config_1.getConfigString)('AI_AGENT_MODEL', 'gpt-4o-mini');
    const result = await (0, aiAgent_1.callAiAgent)(apiKey, apiBaseUrl || undefined, model, conversationHistory, {
        appointments: appointments.length ? appointments : undefined,
        businessHours: { timezone: tz, start, end },
        company_id: companyId,
        services: services.length ? services : undefined,
        staff: staff.length ? staff : undefined,
        client_phone_e164: clientPhone,
        kb_text: kbText,
        free_slots: free_slots.length ? free_slots : undefined
    }, logger);
    // Build DecisionObject skeleton for diagnostics / enrichment (no behaviour change for now).
    let decisionSkeleton = null;
    try {
        const bookingResult = intent === 'BOOKING'
            ? (0, bookingSpecialist_1.evaluateBooking)({
                intent,
                deterministic: undefined,
                freeSlots: free_slots
            })
            : undefined;
        const rescheduleResult = intent === 'RESCHEDULE'
            ? (0, rescheduleSpecialist_1.evaluateReschedule)({
                intent,
                upcomingAppointments: appointments,
                freeSlots: free_slots,
                policyAllowsExecute: policyResult.permissions.canExecuteMutating
            })
            : undefined;
        const cancellationResult = intent === 'CANCEL_REQUEST'
            ? (0, cancellationSpecialist_1.evaluateCancellation)({
                intent,
                upcomingAppointments: appointments,
                requiresAdminApproval: policyResult.permissions.requiresAdminApproval,
                canExecuteMutating: policyResult.permissions.canExecuteMutating
            })
            : undefined;
        const clientContext = (0, clientContext_1.buildClientContext)({
            phoneE164: clientPhone,
            conversation: conv,
            lastMessages: rows,
            behaviorOverride: overrides,
            detectedLanguage: effectiveLang,
            languageHint,
            kbContextSummary: kbText,
            upcomingAppointments: appointments
        });
        decisionSkeleton = (0, decisionAssembler_1.assembleDecisionSkeleton)({
            scenario: routed,
            context: clientContext,
            policy: policyResult,
            fallbackLanguage: effectiveLang,
            bookingResult,
            rescheduleResult,
            cancellationResult
        });
        logger.debug?.({ conversationId, decisionSkeleton }, 'Decision skeleton built');
    }
    catch (_) {
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
        const ctx = {
            reason_code: 'low_confidence',
            confidence: result.confidence,
            decision: result.decision,
            reply_text_preview: result.reply_text ?? undefined,
            tags: result.tags ?? undefined
        };
        try {
            const handoffPrep = (0, handoffSpecialist_1.prepareHandoff)({
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
        }
        catch (_) {
            // diagnostics only
        }
        await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, ctx);
        if (decisionSkeleton) {
            await (0, decisionDiagnostics_1.persistDecisionSnapshot)(db, conversationId, decisionSkeleton);
        }
        return;
    }
    if (result.decision === 'HANDOFF') {
        if (!safePolicy.allow_agent_to_create_handoff) {
            if (safePolicy.allow_agent_to_reply && result.reply_text)
                await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
            else
                await sendAndLog(db, clientPhone, (0, localization_1.getSystemMessage)('generic_ack', effectiveLang), conversationId, logger);
            await sendToSummary(`[${clientPhone}] AI HANDOFF but policy disallows handoff → reply only.`);
            return;
        }
        const summary = result.handoff?.summary || result.handoff?.reason || batchText.slice(0, 200);
        const ctx = {
            reason_code: 'ai_handoff',
            confidence: result.confidence,
            decision: 'HANDOFF',
            reply_text_preview: result.reply_text ?? undefined,
            tags: result.tags ?? undefined
        };
        try {
            const handoffPrep = (0, handoffSpecialist_1.prepareHandoff)({
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
        }
        catch (_) {
            // diagnostics only
        }
        await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, ctx);
        if (decisionSkeleton) {
            await (0, decisionDiagnostics_1.persistDecisionSnapshot)(db, conversationId, decisionSkeleton);
        }
        if (result.reply_text)
            await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
        return;
    }
    if (result.decision === 'NEED_APPROVAL') {
        if (!safePolicy.allow_agent_to_create_handoff) {
            if (safePolicy.allow_agent_to_reply && result.reply_text)
                await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
            else
                await sendAndLog(db, clientPhone, (0, localization_1.getSystemMessage)('generic_ack', effectiveLang), conversationId, logger);
            await sendToSummary(`[${clientPhone}] NEED_APPROVAL but policy disallows handoff → reply only.`);
            return;
        }
        const summary = result.handoff?.summary || `Approval requested: ${batchText.slice(0, 150)}`;
        const ctx = {
            reason_code: 'need_approval',
            confidence: result.confidence,
            decision: 'NEED_APPROVAL',
            reply_text_preview: result.reply_text ?? undefined,
            tags: result.tags ?? undefined
        };
        try {
            const handoffPrep = (0, handoffSpecialist_1.prepareHandoff)({
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
        }
        catch (_) {
            // diagnostics only
        }
        await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, ctx);
        if (decisionSkeleton) {
            await (0, decisionDiagnostics_1.persistDecisionSnapshot)(db, conversationId, decisionSkeleton);
        }
        if (result.reply_text)
            await sendAndLog(db, clientPhone, result.reply_text, conversationId, logger);
        return;
    }
    if (result.decision === 'RESPOND') {
        let createAppointmentFailed = false;
        let createAppointmentSucceeded = false;
        const executionItems = [];
        if (Array.isArray(result.mcp_calls) && result.mcp_calls.length > 0) {
            for (const item of result.mcp_calls) {
                const tool = typeof item?.tool === 'string' ? item.tool : null;
                const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
                if (!tool)
                    continue;
                const mutating = (0, scenarioPolicy_1.isMutatingTool)(tool);
                const execItemBase = {
                    tool,
                    payload: payload,
                    mutating
                };
                if ((0, scenarioPolicy_1.isMutatingTool)(tool) && !safePolicy.allow_agent_to_execute) {
                    logger.info({ tool, conversationId, scenarioCode: safePolicy.scenario_code }, 'MCP mutating tool skipped by policy (allow_agent_to_execute=false)');
                    try {
                        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'execution_denied_by_policy', { tool, reason: 'allow_agent_to_execute=false' });
                    }
                    catch (_) { }
                    if (tool === 'crm.create_appointment')
                        createAppointmentFailed = true;
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
                    await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'tool_called', { tool });
                }
                catch (_) { }
                try {
                    await (0, mcpClient_1.callMcp)(tool, payload, companyId, requestId);
                    if (tool === 'crm.create_appointment')
                        createAppointmentSucceeded = true;
                    logger.info({ tool, conversationId }, 'MCP call from AI executed');
                    try {
                        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'tool_succeeded', { tool });
                    }
                    catch (_) { }
                    if (decisionSkeleton) {
                        executionItems.push({
                            ...execItemBase,
                            status: 'executed'
                        });
                    }
                }
                catch (err) {
                    logger.warn({ err, tool, conversationId }, 'MCP call from AI failed');
                    try {
                        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'tool_failed', { tool, error: String(err?.message ?? err) });
                    }
                    catch (_) { }
                    if (tool === 'crm.create_appointment')
                        createAppointmentFailed = true;
                    if (decisionSkeleton) {
                        executionItems.push({
                            ...execItemBase,
                            status: 'failed',
                            note: String(err?.message ?? err)
                        });
                    }
                }
            }
        }
        if (createAppointmentFailed) {
            const neutralMsg = (0, localization_1.getSystemMessage)('booking_failed', effectiveLang);
            await sendAndLog(db, clientPhone, neutralMsg, conversationId, logger);
            await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, 'Booking API failed (slot conflict or validation); client needs alternative or manual booking.', effectiveLang, { reason_code: 'booking_failed', reply_text_preview: result.reply_text ?? undefined });
            await sendToSummary(`[${clientPhone}] create_appointment failed → handoff.`);
            return;
        }
        const replyLooksConfirmed = /подтвержден|confirmed|забронирован|booked|подходит|записал|записала/i.test(result.reply_text ?? '');
        if (replyLooksConfirmed && !createAppointmentSucceeded) {
            logger.warn({ conversationId }, 'AI claimed booking confirmed but create_appointment was not executed → escalate');
            const neutralMsg = (0, localization_1.getSystemMessage)('booking_not_confirmed_fallback', effectiveLang);
            await sendAndLog(db, clientPhone, neutralMsg, conversationId, logger);
            await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, 'AI replied "confirmed" without successful create_appointment; needs manual booking.', effectiveLang, { reason_code: 'fake_confirmation_blocked', reply_text_preview: result.reply_text ?? undefined });
            await sendToSummary(`[${clientPhone}] Fake confirmation blocked → handoff.`);
            return;
        }
        const writerOutput = (0, writer_1.writeReply)({
            scenarioCode,
            language: effectiveLang,
            replyCandidate: result.reply_text ?? null,
            allowAgentToReply: safePolicy.allow_agent_to_reply
        });
        const qaResult = (0, replyQaGuard_1.runReplyQaGuard)({
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
                await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'reply_blocked', { reason: 'allow_agent_to_reply=false' });
            }
            catch (_) { }
        }
        try {
            await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'reply_sent', { length: replyToSend.length });
        }
        catch (_) { }
        await sendAndLog(db, clientPhone, replyToSend, conversationId, logger);
        if (decisionSkeleton) {
            await (0, decisionDiagnostics_1.persistDecisionSnapshot)(db, conversationId, decisionSkeleton);
        }
        await sendToSummary(`[${clientPhone}] AI RESPOND (confidence ${result.confidence}) writer_used_fallback=${writerOutput.usedFallback} qa_fallback_used=${qaResult.fallbackUsed} qa_issues=${qaResult.issues
            .map((i) => i.code)
            .join(',') || 'none'}.`);
    }
}
async function createHandoffAndPause(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, effectiveLang) {
    const summary = `Handoff: ${batch.map((m) => m.text).join(' ').slice(0, 200)}`;
    await createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, { reason_code: 'legacy_handoff' });
}
async function createHandoffAndPauseWithSummary(db, conversationId, clientPhone, batch, logger, sendToSummary, requestId, summary, effectiveLang, handoffContext) {
    const payload = { summary: summary.slice(0, 500) };
    if (handoffContext) {
        payload.reason_code = handoffContext.reason_code;
        if (handoffContext.confidence != null)
            payload.confidence = handoffContext.confidence;
        if (handoffContext.decision)
            payload.decision = handoffContext.decision;
        if (handoffContext.reply_text_preview)
            payload.reply_text_preview = handoffContext.reply_text_preview.slice(0, 300);
        if (handoffContext.tags?.length)
            payload.tags = handoffContext.tags;
    }
    try {
        await (0, conversationEvents_1.appendConversationEvent)(db, conversationId, 'handoff_created', payload);
    }
    catch (_) { }
    const companyId = Number(await (0, config_1.getConfig)('DEFAULT_COMPANY_ID')) || 1169276;
    const questionToAdmin = 'Please handle this conversation.';
    const lastMessages = (await (0, messageStore_1.getLastMessages)(db, conversationId, 10)).map((m) => ({
        ts: m.ts,
        from: m.author,
        text: m.text
    }));
    const caseId = await (0, handoff_1.createHandoffCase)(db, {
        conversationId,
        clientPhone,
        summary,
        questionToAdmin
    });
    await (0, handoff_1.addPendingAction)(db, {
        type: 'HANDOFF',
        conversationId,
        clientPhone,
        caseId
    });
    await (0, conversation_1.setConversationState)(db, conversationId, 'AWAITING_ADMIN');
    const pauseMsg = (0, localization_1.getSystemMessage)('handoff_ack', effectiveLang);
    await sendAndLog(db, clientPhone, pauseMsg, conversationId, logger);
    try {
        await (0, mcpClient_1.createHandoffViaMcp)(conversationId, clientPhone, summary, questionToAdmin, lastMessages, companyId, requestId);
    }
    catch (_) { }
    let telegramLine = `[${clientPhone}] Handoff case ${caseId}: ${summary.slice(0, 80)}...`;
    if (handoffContext) {
        telegramLine += `\nПричина: ${handoffContext.reason_code}`;
        if (handoffContext.confidence != null)
            telegramLine += ` | уверенность: ${handoffContext.confidence}`;
        if (handoffContext.decision)
            telegramLine += ` | решение ИИ: ${handoffContext.decision}`;
        if (handoffContext.reply_text_preview)
            telegramLine += `\nОтвет ИИ (не отправлен): ${handoffContext.reply_text_preview.slice(0, 150)}...`;
        if (handoffContext.tags?.length)
            telegramLine += `\nТеги: ${handoffContext.tags.join(', ')}`;
    }
    await sendToSummary(telegramLine);
}
//# sourceMappingURL=agentProcessor.js.map