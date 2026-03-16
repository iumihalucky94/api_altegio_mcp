import type { DbPool } from '../db';
export interface AuditActor {
    actor_type: string;
    actor_id: string;
}
export interface AuditParams {
    actor: AuditActor;
    source: string;
    action: string;
    entity_table: string;
    entity_id?: string | null;
    before?: unknown;
    after?: unknown;
    correlation_id?: string | null;
    request_id?: string | null;
    conversation_id?: string | null;
    client_phone?: string | null;
    metadata?: Record<string, unknown> | null;
}
export declare function logAudit(db: DbPool, params: AuditParams): Promise<void>;
//# sourceMappingURL=audit.d.ts.map