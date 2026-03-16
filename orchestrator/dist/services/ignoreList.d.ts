import type { DbPool } from '../db';
export type IgnoreMode = 'IGNORE' | 'ADMIN_ONLY';
export declare function getIgnoreMode(db: DbPool, phone: string): Promise<IgnoreMode | null>;
export declare function setIgnore(db: DbPool, phone: string, mode: IgnoreMode, reason?: string, by?: string): Promise<void>;
export declare function unignore(db: DbPool, phone: string): Promise<void>;
//# sourceMappingURL=ignoreList.d.ts.map