import type { DbPool } from '../db';
import type { QueuedMessage } from './debounce';
export declare function processBatch(db: DbPool, batch: QueuedMessage[], logger: any, sendToSummary: (msg: string) => Promise<void>, companyId: number): Promise<void>;
/** Context for why handoff happened (for audit and Telegram). */
export interface HandoffContext {
    reason_code: string;
    confidence?: number;
    decision?: string;
    reply_text_preview?: string;
    tags?: string[];
}
//# sourceMappingURL=agentProcessor.d.ts.map