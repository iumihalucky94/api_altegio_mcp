import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type DbPool = any;

export async function createDbPool(config: any): Promise<DbPool> {
  const pool = new (Pool as any)(config);
  // Simple connectivity check
  await pool.query('SELECT 1');
  return pool;
}

const MIGRATIONS = [
  '001_init.sql',
  '002_mcp_admin_protocol.sql',
  '003_mcp_hardening.sql',
  '004_orchestrator.sql',
  '005_kb.sql',
  '006_audit_log.sql',
  '007_wa_service_config.sql',
  '008_conversations_extend.sql',
  '009_scenarios_and_policies.sql',
  '010_conversation_events.sql',
  '011_conversation_reviews.sql',
  '012_conversation_corrections.sql'
];

export async function runMigrations(pool: DbPool, logger: any) {
  const baseCandidates = [
    join(process.cwd(), 'db/migrations'),
    join(process.cwd(), '../db/migrations')
  ];
  const base = baseCandidates.find((p) => existsSync(p));
  if (!base) {
    const err = new Error('db/migrations directory not found');
    logger.error({ candidates: baseCandidates }, 'Failed to locate migrations');
    throw err;
  }
  for (const name of MIGRATIONS) {
    const migrationPath = join(base, name);
    if (!existsSync(migrationPath)) continue;
    let sql: string;
    try {
      sql = readFileSync(migrationPath, 'utf-8');
    } catch (err) {
      logger.error({ err, migrationPath }, 'Failed to read migration file');
      throw err;
    }
    try {
      await pool.query(sql);
      logger.info({ migrationPath }, 'Migration applied');
    } catch (err) {
      logger.error({ err, migrationPath }, 'Failed to apply migration');
      throw err;
    }
  }
}


