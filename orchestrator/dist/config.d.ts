import type { DbPool } from './db';
export declare function initConfig(db: DbPool, defaults: Record<string, unknown>): void;
export declare function getConfig<T = unknown>(key: string): Promise<T>;
export declare function getConfigString(key: string, fallback: string): Promise<string>;
export declare function getConfigNumber(key: string, fallback: number): Promise<number>;
export declare function getConfigBoolean(key: string, fallback: boolean): Promise<boolean>;
//# sourceMappingURL=config.d.ts.map