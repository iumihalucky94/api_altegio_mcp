import type { DbPool } from '../db';
export declare function persistMessage(db: DbPool, params: {
    conversationId: string;
    clientPhone: string;
    ts: Date;
    direction: 'in' | 'out';
    author: 'client' | 'agent' | 'admin';
    text: string;
    messageId?: string | null;
    locale?: string | null;
    metadata?: Record<string, unknown> | null;
}): Promise<boolean>;
export declare function getLastMessages(db: DbPool, conversationId: string, limit: number): Promise<Array<{
    ts: string;
    direction: string;
    author: string;
    text: string;
}>>;
//# sourceMappingURL=messageStore.d.ts.map