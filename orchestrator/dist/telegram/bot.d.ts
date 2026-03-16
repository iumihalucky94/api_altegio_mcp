import type { DbPool } from '../db';
export declare function startTelegramBot(db: DbPool, token: string, log: any): Promise<{
    sendSummary: (msg: string) => Promise<void>;
    sendLogs: (payload: object) => Promise<void>;
}>;
//# sourceMappingURL=bot.d.ts.map