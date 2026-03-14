import type { DbPool } from '../db';
import { logAudit } from './audit';

export interface BehaviorOverride {
  phone: string;
  language_preference: string | null;
  tone_profile: string | null;
  force_handoff: boolean;
  notes_for_agent: string | null;
  blocked_topics: string[] | null;
  updated_at: string;
  updated_by: string;
}

export async function getBehaviorOverride(db: DbPool, phone: string): Promise<BehaviorOverride | null> {
  const res = await db.query(
    `SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics,
            updated_at::text, updated_by FROM client_behavior_overrides WHERE phone = $1`,
    [phone]
  );
  return (res.rows[0] as BehaviorOverride) ?? null;
}

export async function setRule(
  db: DbPool,
  phone: string,
  key: string,
  value: string | boolean,
  by = 'admin'
) {
  const col = key as keyof BehaviorOverride;
  if (col === 'language_preference' || col === 'tone_profile' || col === 'notes_for_agent') {
    const beforeRes = await db.query(
      `SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`,
      [phone]
    );
    const before = beforeRes.rows[0] ?? null;
    await db.query(
      `INSERT INTO client_behavior_overrides (phone, ${col}, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (phone) DO UPDATE SET ${col} = $2, updated_at = now(), updated_by = $3`,
      [phone, value, by]
    );
    const afterRes = await db.query(
      `SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`,
      [phone]
    );
    const after = afterRes.rows[0] ?? null;
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: by },
      source: 'behavior_overrides',
      action: 'behavior.override.update',
      entity_table: 'client_behavior_overrides',
      entity_id: phone,
      before,
      after,
      client_phone: phone
    });
  } else if (col === 'force_handoff') {
    const b = value === true || value === 'true' || value === '1';
    const beforeRes = await db.query(
      `SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`,
      [phone]
    );
    const before = beforeRes.rows[0] ?? null;
    await db.query(
      `INSERT INTO client_behavior_overrides (phone, force_handoff, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (phone) DO UPDATE SET force_handoff = $2, updated_at = now(), updated_by = $3`,
      [phone, b, by]
    );
    const afterRes = await db.query(
      `SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`,
      [phone]
    );
    const after = afterRes.rows[0] ?? null;
    await logAudit(db, {
      actor: { actor_type: 'admin', actor_id: by },
      source: 'behavior_overrides',
      action: 'behavior.override.update',
      entity_table: 'client_behavior_overrides',
      entity_id: phone,
      before,
      after,
      client_phone: phone
    });
  }
}
