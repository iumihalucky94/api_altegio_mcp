/**
 * Config: ENV with optional override from admin_config (same DB as gateway/orchestrator).
 */
import { Pool } from 'pg';

let pool: Pool | null = null;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

export function setConfigPool(p: Pool) {
  pool = p;
}

async function loadFromDb(key: string): Promise<unknown | undefined> {
  if (!pool) return undefined;
  try {
    const res = await pool.query('SELECT value_json FROM admin_config WHERE key = $1', [key]);
    if (res.rows.length === 0) return undefined;
    const v = res.rows[0].value_json;
    if (typeof v === 'string' && v.startsWith('"')) return JSON.parse(v) as string;
    return v;
  } catch {
    return undefined;
  }
}

export async function getConfigString(key: string, envFallback: string): Promise<string> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) return String(entry.value ?? envFallback);

  const dbVal = await loadFromDb(key);
  const raw = dbVal !== undefined && dbVal !== null ? String(dbVal) : envFallback;
  const out = raw.trim() || envFallback;
  cache.set(key, { value: out, expiresAt: now + CACHE_TTL_MS });
  return out;
}
