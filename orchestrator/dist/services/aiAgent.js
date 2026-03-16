"use strict";
/**
 * AI Agent service: calls OpenAI-compatible API with SISI system prompt,
 * expects JSON-only response (decision, confidence, reply_text, handoff, tags).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.callAiAgent = callAiAgent;
const aiAgentSystemPrompt_1 = require("../prompts/aiAgentSystemPrompt");
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;
function extractJson(text) {
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start)
        return trimmed;
    return trimmed.slice(start, end + 1);
}
async function callAiAgent(apiKey, apiBaseUrl, model, conversationHistory, context, log) {
    const key = (apiKey || '').trim().split(/#/)[0].trim();
    if (!key)
        return null;
    const rawBase = (apiBaseUrl || 'https://api.openai.com/v1').trim().split(/#/)[0].trim();
    let baseUrl = rawBase.replace(/\/$/, '');
    if (baseUrl && baseUrl.startsWith('https://api.openai.com') && !baseUrl.endsWith('/v1'))
        baseUrl = 'https://api.openai.com/v1';
    const url = `${baseUrl}/chat/completions`;
    const parts = [];
    if (context?.appointments?.length)
        parts.push(`Upcoming appointments: ${JSON.stringify(context.appointments)}`);
    if (context?.businessHours)
        parts.push(`Business hours: ${context.businessHours.timezone} ${context.businessHours.start}-${context.businessHours.end}`);
    if (context?.company_id != null)
        parts.push(`company_id (use in mcp_calls): ${context.company_id}`);
    if (context?.services?.length)
        parts.push(`Services (id, name for crm.create_appointment): ${JSON.stringify(context.services)}`);
    if (context?.staff?.length)
        parts.push(`Staff (id, name for crm.create_appointment): ${JSON.stringify(context.staff)}`);
    if (context?.client_phone_e164)
        parts.push(`client_phone for mcp_calls (use in create_appointment payload): ${context.client_phone_e164}`);
    if (context?.free_slots?.length)
        parts.push(`FREE_SLOTS (ONLY suggest or confirm times from this list; never offer or confirm any other time): ${JSON.stringify(context.free_slots)}`);
    const contextBlock = parts.length ? `\n\nCONTEXT:\n${parts.join('\n')}` : '';
    const kbBlock = context?.kb_text ? `\n\n${context.kb_text}` : '';
    const systemContent = aiAgentSystemPrompt_1.AI_AGENT_SYSTEM_PROMPT + kbBlock + contextBlock;
    const messages = [
        { role: 'system', content: systemContent }
    ];
    for (const m of conversationHistory) {
        messages.push({ role: m.role, content: m.content });
    }
    const modelClean = (model || DEFAULT_MODEL).trim().split(/#/)[0].trim() || DEFAULT_MODEL;
    const body = {
        model: modelClean,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        response_format: { type: 'json_object' }
    };
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errText = await res.text();
            log.error({ status: res.status, body: errText.slice(0, 500) }, 'AI agent API error');
            return null;
        }
        const data = (await res.json());
        if (data.error?.message) {
            log.error({ error: data.error.message }, 'AI agent API error');
            return null;
        }
        const content = data.choices?.[0]?.message?.content;
        if (!content || typeof content !== 'string') {
            log.warn({ data }, 'AI agent empty or invalid response');
            return null;
        }
        const raw = content.trim().startsWith('{') ? content : extractJson(content);
        const parsed = JSON.parse(raw);
        const decision = parsed.decision || 'HANDOFF';
        const validDecision = ['RESPOND', 'HANDOFF', 'NEED_APPROVAL'].includes(decision)
            ? decision
            : 'HANDOFF';
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
        const reply_text = typeof parsed.reply_text === 'string' ? parsed.reply_text : parsed.reply_text === null ? null : null;
        const mcp_calls = Array.isArray(parsed.mcp_calls) ? parsed.mcp_calls : [];
        const handoffRaw = parsed.handoff;
        const handoff = handoffRaw && typeof handoffRaw === 'object' && !Array.isArray(handoffRaw)
            ? {
                reason: typeof handoffRaw.reason === 'string' ? handoffRaw.reason : undefined,
                summary: typeof handoffRaw.summary === 'string' ? handoffRaw.summary : undefined
            }
            : null;
        const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
        return {
            decision: validDecision,
            confidence,
            reply_text,
            mcp_calls,
            handoff,
            tags
        };
    }
    catch (err) {
        log.error({ err }, 'AI agent call failed');
        return null;
    }
}
//# sourceMappingURL=aiAgent.js.map