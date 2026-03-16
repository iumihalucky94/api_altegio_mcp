import type { DbPool } from '../db';
export declare function createHandoffCase(db: DbPool, params: {
    conversationId: string;
    clientPhone: string;
    summary: string;
    questionToAdmin: string;
    relatedAuditIds?: string[];
}): Promise<string>;
export declare function addPendingAction(db: DbPool, params: {
    type: string;
    conversationId?: string;
    clientPhone: string;
    caseId?: string;
    approvalId?: string;
}): Promise<void>;
export declare function getOpenPendingActions(db: DbPool): Promise<Array<{
    id: string;
    type: string;
    conversation_id: string | null;
    client_phone: string;
    case_id: string | null;
    approval_id: string | null;
    created_at: string;
    last_reminded_at: string | null;
    reminder_count: number;
}>>;
export declare function markPendingDone(db: DbPool, approvalId: string): Promise<void>;
export declare function updateReminder(db: DbPool, id: string): Promise<void>;
export declare function getCase(db: DbPool, caseId: string): Promise<any>;
export declare function getOpenHandoffCases(db: DbPool): Promise<Array<{
    id: string;
    conversation_id: string;
    client_phone: string;
    summary: string;
    question_to_admin: string | null;
    created_at: string;
}>>;
export interface ContactNeedingAttention {
    client_phone: string;
    state: string;
    state_updated_at: string;
    open_cases: Array<{
        id: string;
        summary: string;
        question_to_admin: string | null;
        created_at: string;
    }>;
    pending_actions: Array<{
        id: string;
        type: string;
        approval_id: string | null;
        created_at: string;
    }>;
}
/** Список контактов, где нужна реакция админа: AWAITING_ADMIN, ADMIN_TAKEOVER + открытые кейсы и pending actions. */
export declare function getContactsNeedingAttention(db: DbPool): Promise<ContactNeedingAttention[]>;
//# sourceMappingURL=handoff.d.ts.map