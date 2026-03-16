import type { DbPool } from '../db';
export type ConversationState = 'BOT_ACTIVE' | 'BOT_PAUSED' | 'ADMIN_TAKEOVER' | 'AWAITING_ADMIN' | 'IGNORED';
export interface ConversationRow {
    conversation_id: string;
    client_phone: string;
    state: ConversationState;
    state_updated_at: string;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
    language_hint: string | null;
    takeover_until: string | null;
    metadata_json: Record<string, unknown> | null;
}
export declare function getOrCreateConversation(db: DbPool, conversationId: string, clientPhone: string): Promise<ConversationRow>;
/** Optionally update extended columns (detected_primary_language, current_scenario_code). No-op if columns missing. */
export declare function updateConversationLanguageAndScenario(db: DbPool, conversationId: string, detectedPrimaryLanguage: string, currentScenarioCode: string): Promise<void>;
export declare function setConversationState(db: DbPool, conversationId: string, state: ConversationState, takeoverUntil?: Date | null): Promise<void>;
export declare function updateLastInbound(db: DbPool, conversationId: string): Promise<void>;
export declare function updateLastOutbound(db: DbPool, conversationId: string): Promise<void>;
export declare function shouldBotRespond(state: ConversationState, _now?: Date): boolean;
export declare function statePriority(state: ConversationState): number;
export declare function getConversation(db: DbPool, conversationId: string): Promise<ConversationRow | null>;
export declare function getConversationByPhone(db: DbPool, clientPhone: string): Promise<ConversationRow | null>;
//# sourceMappingURL=conversation.d.ts.map