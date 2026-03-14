/**
 * AI Agent service: calls OpenAI-compatible API with SISI system prompt,
 * expects JSON-only response (decision, confidence, reply_text, handoff, tags).
 */

import { AI_AGENT_SYSTEM_PROMPT } from '../prompts/aiAgentSystemPrompt';

export interface AiAgentContext {
  /** Pre-fetched appointments for the client (from MCP). */
  appointments?: Array<{ id?: string; start?: string; service?: string; master?: string }>;
  /** Business hours / timezone hint for the model. */
  businessHours?: { timezone: string; start: string; end: string };
  /** company_id for MCP calls (e.g. create_appointment). */
  company_id?: number;
  /** List of services (id, name) for booking. */
  services?: Array<{ id: number; name?: string }>;
  /** List of staff (id, name) for booking. */
  staff?: Array<{ id: number; name?: string }>;
  /** Client phone E.164 for mcp_calls (e.g. create_appointment). */
  client_phone_e164?: string;
  /** Optional pre-built KB context block (text). */
  kb_text?: string;
  /** Pre-fetched free slot start times (ISO) — ONLY suggest these; never confirm time outside this list. */
  free_slots?: string[];
}

export interface AiAgentOutput {
  decision: 'RESPOND' | 'HANDOFF' | 'NEED_APPROVAL';
  confidence: number;
  reply_text: string | null;
  mcp_calls: unknown[];
  handoff: { reason?: string; summary?: string } | null;
  tags: string[];
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;

function extractJson(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}

export async function callAiAgent(
  apiKey: string,
  apiBaseUrl: string | undefined,
  model: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: AiAgentContext | undefined,
  log: { warn: (o: object, msg?: string) => void; error: (o: object, msg?: string) => void }
): Promise<AiAgentOutput | null> {
  const key = (apiKey || '').trim().split(/#/)[0].trim();
  if (!key) return null;
  const rawBase = (apiBaseUrl || 'https://api.openai.com/v1').trim().split(/#/)[0].trim();
  let baseUrl = rawBase.replace(/\/$/, '');
  if (baseUrl && baseUrl.startsWith('https://api.openai.com') && !baseUrl.endsWith('/v1')) baseUrl = 'https://api.openai.com/v1';
  const url = `${baseUrl}/chat/completions`;

  const parts: string[] = [];
  if (context?.appointments?.length) parts.push(`Upcoming appointments: ${JSON.stringify(context.appointments)}`);
  if (context?.businessHours) parts.push(`Business hours: ${context.businessHours.timezone} ${context.businessHours.start}-${context.businessHours.end}`);
  if (context?.company_id != null) parts.push(`company_id (use in mcp_calls): ${context.company_id}`);
  if (context?.services?.length) parts.push(`Services (id, name for crm.create_appointment): ${JSON.stringify(context.services)}`);
  if (context?.staff?.length) parts.push(`Staff (id, name for crm.create_appointment): ${JSON.stringify(context.staff)}`);
  if (context?.client_phone_e164) parts.push(`client_phone for mcp_calls (use in create_appointment payload): ${context.client_phone_e164}`);
  if (context?.free_slots?.length) parts.push(`FREE_SLOTS (ONLY suggest or confirm times from this list; never offer or confirm any other time): ${JSON.stringify(context.free_slots)}`);
  const contextBlock = parts.length ? `\n\nCONTEXT:\n${parts.join('\n')}` : '';

  const kbBlock = context?.kb_text ? `\n\n${context.kb_text}` : '';
  const systemContent = AI_AGENT_SYSTEM_PROMPT + kbBlock + contextBlock;
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
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
    response_format: { type: 'json_object' as const }
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

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const decision = (parsed.decision as string) || 'HANDOFF';
    const validDecision = ['RESPOND', 'HANDOFF', 'NEED_APPROVAL'].includes(decision)
      ? (decision as AiAgentOutput['decision'])
      : 'HANDOFF';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    const reply_text =
    typeof parsed.reply_text === 'string' ? parsed.reply_text : parsed.reply_text === null ? null : null;
    const mcp_calls = Array.isArray(parsed.mcp_calls) ? parsed.mcp_calls : [];
    const handoffRaw = parsed.handoff;
    const handoff =
      handoffRaw && typeof handoffRaw === 'object' && !Array.isArray(handoffRaw)
        ? {
            reason: typeof (handoffRaw as any).reason === 'string' ? (handoffRaw as any).reason : undefined,
            summary: typeof (handoffRaw as any).summary === 'string' ? (handoffRaw as any).summary : undefined
          }
        : null;
    const tags = Array.isArray(parsed.tags) ? (parsed.tags as string[]) : [];

    return {
      decision: validDecision,
      confidence,
      reply_text,
      mcp_calls,
      handoff,
      tags
    };
  } catch (err) {
    log.error({ err }, 'AI agent call failed');
    return null;
  }
}
