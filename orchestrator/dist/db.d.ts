import { Pool } from 'pg';
export type DbPool = InstanceType<typeof Pool>;
export declare function createDbPool(config: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
}): Promise<DbPool>;
//# sourceMappingURL=db.d.ts.map