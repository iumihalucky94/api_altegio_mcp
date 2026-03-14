import type { DbPool } from './db';

type CacheEntry = { value: unknown; expiresAt: number };
let dbRef: DbPool | null = null;
const envDefaults = new Map<string, unknown>();
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15000;

export function initConfig(db: DbPool, defaults: Record<string, unknown>) {
  dbRef = db;
  Object.entries(defaults).forEach(([k, v]) => envDefaults.set(k, v));
}

async function loadFromDb(key: string): Promise<unknown | undefined> {
  if (!dbRef) return undefined;
  const res = await dbRef.query('SELECT value_json FROM admin_config WHERE key = $1', [key]);
  if (res.rows.length === 0) return undefined;
  const v = res.rows[0].value_json;
  if (typeof v === 'string' && v.startsWith('"')) return JSON.parse(v);
  return v;
}

export async function getConfig<T = unknown>(key: string): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) return entry.value as T;
  const dbVal = await loadFromDb(key);
  const envVal = envDefaults.get(key);
  const out = (dbVal ?? envVal) as T;
  cache.set(key, { value: out, expiresAt: now + CACHE_TTL_MS });
  return out;
}

export async function getConfigString(key: string, fallback: string): Promise<string> {
  const v = await getConfig(key);
  if (v === undefined || v === null) return fallback;
  return String(v);
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const v = await getConfig(key);
  if (v === undefined || v === null) return fallback;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function getConfigBoolean(key: string, fallback: boolean): Promise<boolean> {
  const v = await getConfig(key);
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1';
}
