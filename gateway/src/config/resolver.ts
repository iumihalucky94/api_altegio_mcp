import { DbPool } from '../audit/db';

export interface ConfigSnapshot {
  slots_default_limit: number;
  preferred_master_threshold: number;
  cancel_policy_mode: string;
  rate_limit: {
    enabled: boolean;
    rps: number;
    rpm: number;
    burst: number;
  };
  timeouts: {
    gateway_request_ms: number;
    altegios_http_ms: number;
    operation_budget_ms: number;
  };
  logging: {
    correlation_id_source: string;
  };
}

type CacheEntry = { value: unknown; expiresAt: number };

let dbRef: DbPool | null = null;
const envDefaults = new Map<string, unknown>();
const cache = new Map<string, CacheEntry>();
let cacheTtlMs = 10000;
let cacheTtlLoadedAt = 0;

export function initConfigService(db: DbPool, defaults: Record<string, unknown>) {
  dbRef = db;
  Object.entries(defaults).forEach(([k, v]) => {
    envDefaults.set(k, v);
  });
}

async function loadFromDb(key: string): Promise<unknown | undefined> {
  if (!dbRef) {
    throw new Error('Config service not initialized');
  }
  const res = await dbRef.query('SELECT value_json FROM admin_config WHERE key = $1', [key]);
  if (res.rows.length === 0) return undefined;
  return res.rows[0].value_json;
}

async function refreshCacheTtlIfNeeded() {
  const now = Date.now();
  // Refresh TTL config at most once per 60s
  if (now - cacheTtlLoadedAt < 60000) return;
  const dbVal = await loadFromDb('config.cache_ttl_ms');
  const envVal = envDefaults.get('config.cache_ttl_ms');
  const base = (dbVal ?? envVal ?? 10000) as number;
  const parsed = typeof base === 'string' ? parseInt(base, 10) : base;
  cacheTtlMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  cacheTtlLoadedAt = now;
}

export async function getConfig<T = unknown>(key: string, overrideEnvDefault?: T): Promise<T> {
  const now = Date.now();

  // Always refresh TTL baseline first (except when reading the TTL itself)
  if (key !== 'config.cache_ttl_ms') {
    await refreshCacheTtlIfNeeded();
  }

  if (key === 'config.cache_ttl_ms') {
    const dbVal = await loadFromDb(key);
    const envVal = overrideEnvDefault ?? (envDefaults.get(key) as T | undefined);
    const base = (dbVal ?? envVal ?? 10000) as T;
    return base;
  }

  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.value as T;
  }

  const dbVal = await loadFromDb(key);
  const envVal = overrideEnvDefault ?? (envDefaults.get(key) as T | undefined);
  const base = (dbVal ?? envVal) as T;

  cache.set(key, { value: base, expiresAt: now + cacheTtlMs });
  return base;
}

export async function getConfigSnapshot(): Promise<ConfigSnapshot> {
  const slots_default_limit = (await getConfig<number>('slots_default_limit')) ?? 3;
  const preferred_master_threshold =
    (await getConfig<number>('preferred_master_threshold')) ?? 0.8;
  const cancel_policy_mode =
    (await getConfig<string>('cancel_policy_mode')) ?? 'always_approval';

  const rlEnabled = !!(await getConfig<boolean>('ratelimit.enabled'));
  const rlRps = (await getConfig<number>('ratelimit.per_agent.rps')) ?? 2;
  const rlRpm = (await getConfig<number>('ratelimit.per_agent.rpm')) ?? 60;
  const rlBurst = (await getConfig<number>('ratelimit.burst')) ?? 5;

  const gwTimeout =
    (await getConfig<number>('timeouts.gateway_request_ms')) ?? 15000;
  const altegioTimeout =
    (await getConfig<number>('timeouts.altegios_http_ms')) ?? 8000;
  const opBudget =
    (await getConfig<number>('timeouts.operation_budget_ms')) ?? 20000;

  const corrSource =
    (await getConfig<string>('logging.correlation_id_source')) ?? 'request_id';

  return {
    slots_default_limit,
    preferred_master_threshold,
    cancel_policy_mode,
    rate_limit: {
      enabled: rlEnabled,
      rps: rlRps,
      rpm: rlRpm,
      burst: rlBurst
    },
    timeouts: {
      gateway_request_ms: gwTimeout,
      altegios_http_ms: altegioTimeout,
      operation_budget_ms: opBudget
    },
    logging: {
      correlation_id_source: corrSource
    }
  };
}

