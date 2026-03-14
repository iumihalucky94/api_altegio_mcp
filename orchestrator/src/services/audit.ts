import type { DbPool } from '../db';

const SECRET_KEYS = new Set([
  'token',
  'secret',
  'password',
  'authorization',
  'bearer',
  'access_token',
  'refresh_token',
  'api_key',
  'cookie',
  'set-cookie',
  'app_secret'
]);

export interface AuditActor {
  actor_type: string;
  actor_id: string;
}

export interface AuditParams {
  actor: AuditActor;
  source: string;
  action: string;
  entity_table: string;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
  correlation_id?: string | null;
  request_id?: string | null;
  conversation_id?: string | null;
  client_phone?: string | null;
  metadata?: Record<string, unknown> | null;
}

function scrub(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrub(v));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (SECRET_KEYS.has(lower)) {
        out[k] = '[redacted]';
      } else if (k === 'webhook_payload' || k === 'raw_payload' || k === 'request_body') {
        out[k] = '[payload_omitted]';
      } else {
        out[k] = scrub(v);
      }
    }
    return out;
  }
  return obj;
}

function shallowDiff(before: unknown, after: unknown): Record<string, unknown> {
  const b = (before && typeof before === 'object' ? (before as any) : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? (after as any) : {}) as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
  const diff: Record<string, unknown> = {};
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      diff[k] = { before: bv, after: av };
    }
  }
  return diff;
}

export async function logAudit(db: DbPool, params: AuditParams) {
  const beforeScrubbed = scrub(params.before);
  const afterScrubbed = scrub(params.after);
  const diff = shallowDiff(beforeScrubbed, afterScrubbed);

  await db.query(
    `INSERT INTO audit_log
     (actor_type, actor_id, source, action, entity_table, entity_id, before_json, after_json, diff_json,
      correlation_id, request_id, conversation_id, client_phone, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      params.actor.actor_type,
      params.actor.actor_id,
      params.source,
      params.action,
      params.entity_table,
      params.entity_id ?? null,
      beforeScrubbed ?? null,
      afterScrubbed ?? null,
      Object.keys(diff).length ? diff : null,
      params.correlation_id ?? null,
      params.request_id ?? null,
      params.conversation_id ?? null,
      params.client_phone ?? null,
      scrub(params.metadata ?? null) ?? null
    ]
  );
}

