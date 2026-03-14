import { Pool } from 'pg';

export type DbPool = InstanceType<typeof Pool>;

export async function createDbPool(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<DbPool> {
  const pool = new Pool(config);
  await pool.query('SELECT 1');
  return pool;
}
