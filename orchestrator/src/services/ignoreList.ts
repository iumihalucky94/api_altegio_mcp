import type { DbPool } from '../db';
import { logAudit } from './audit';

export type IgnoreMode = 'IGNORE' | 'ADMIN_ONLY';

export async function getIgnoreMode(db: DbPool, phone: string): Promise<IgnoreMode | null> {
  const res = await db.query(
    'SELECT mode FROM agent_ignore_phones WHERE phone = $1',
    [phone]
  );
  return res.rows[0]?.mode ?? null;
}

export async function setIgnore(db: DbPool, phone: string, mode: IgnoreMode, reason?: string, by = 'admin') {
  const beforeRes = await db.query('SELECT phone, mode, reason FROM agent_ignore_phones WHERE phone = $1', [
    phone
  ]);
  const before = beforeRes.rows[0] ?? null;
  await db.query(
    `INSERT INTO agent_ignore_phones (phone, mode, reason, updated_at, created_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (phone) DO UPDATE SET mode = $2, reason = $3, updated_at = now()`,
    [phone, mode, reason ?? null, by]
  );
  const afterRes = await db.query('SELECT phone, mode, reason FROM agent_ignore_phones WHERE phone = $1', [
    phone
  ]);
  const after = afterRes.rows[0] ?? null;
  await logAudit(db, {
    actor: { actor_type: 'admin', actor_id: by },
    source: 'ignore',
    action: mode === 'ADMIN_ONLY' ? 'ignore.phone.add_admin_only' : 'ignore.phone.add',
    entity_table: 'agent_ignore_phones',
    entity_id: phone,
    before,
    after,
    client_phone: phone
  });
}

export async function unignore(db: DbPool, phone: string) {
  const beforeRes = await db.query('SELECT phone, mode, reason FROM agent_ignore_phones WHERE phone = $1', [
    phone
  ]);
  const before = beforeRes.rows[0] ?? null;
  await db.query('DELETE FROM agent_ignore_phones WHERE phone = $1', [phone]);
  await logAudit(db, {
    actor: { actor_type: 'admin', actor_id: 'admin' },
    source: 'ignore',
    action: 'ignore.phone.remove',
    entity_table: 'agent_ignore_phones',
    entity_id: phone,
    before,
    after: null,
    client_phone: phone
  });
}
