/**
 * AI Agent service: calls OpenAI-compatible API with SISI system prompt,
 * expects JSON-only response (decision, confidence, reply_text, handoff, tags).
 */
export interface AiAgentContext {
    /** Pre-fetched appointments for the client (from MCP). */
    appointments?: Array<{
        id?: string;
        start?: string;
        service?: string;
        master?: string;
    }>;
    /** Business hours / timezone hint for the model. */
    businessHours?: {
        timezone: string;
        start: string;
        end: string;
    };
    /** company_id for MCP calls (e.g. create_appointment). */
    company_id?: number;
    /** List of services (id, name) for booking. */
    services?: Array<{
        id: number;
        name?: string;
    }>;
    /** List of staff (id, name) for booking. */
    staff?: Array<{
        id: number;
        name?: string;
    }>;
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
    handoff: {
        reason?: string;
        summary?: string;
    } | null;
    tags: string[];
}
export declare function callAiAgent(apiKey: string, apiBaseUrl: string | undefined, model: string, conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
}>, context: AiAgentContext | undefined, log: {
    warn: (o: object, msg?: string) => void;
    error: (o: object, msg?: string) => void;
}): Promise<AiAgentOutput | null>;
//# sourceMappingURL=aiAgent.d.ts.map