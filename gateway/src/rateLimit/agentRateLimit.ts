import { getConfig } from '../config/resolver';

type BucketState = {
  tokensRps: number;
  lastRps: number;
  tokensRpm: number;
  lastRpm: number;
};

const memoryBuckets = new Map<string, BucketState>();

// Redis client is optional; typed as any to avoid dependency on types
let redisClient: any | null = null;
let redisInitTried = false;

async function getRedisClient(logger: any): Promise<any | null> {
  if (redisClient || redisInitTried) return redisClient;
  redisInitTried = true;
  try {
    const host = (await getConfig<string>('redis.host')) || '';
    const port = (await getConfig<number>('redis.port')) || 6379;
    if (!host) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('redis');
    const client = createClient({
      socket: { host, port }
    });
    client.on('error', (err: any) => {
      logger.error({ err }, 'Redis client error in rate limiter');
    });
    await client.connect();
    redisClient = client;
    logger.info({ host, port }, 'Agent rate limiter using Redis backend');
    return redisClient;
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Redis for rate limiting, falling back to memory');
    redisClient = null;
    return null;
  }
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function consumeFromState(
  state: BucketState,
  rps: number,
  rpm: number,
  burst: number
): { allowed: boolean; retryAfterSeconds?: number; nextState: BucketState } {
  const now = nowSeconds();

  // RPS bucket
  const elapsedRps = now - state.lastRps;
  const newTokensRps = Math.min(
    burst,
    state.tokensRps + elapsedRps * rps
  );

  // RPM bucket
  const elapsedRpm = now - state.lastRpm;
  const rpmCapacity = rpm;
  const newTokensRpm = Math.min(
    rpmCapacity,
    state.tokensRpm + (elapsedRpm / 60) * rpm
  );

  let tokensRps = newTokensRps;
  let tokensRpm = newTokensRpm;

  if (tokensRps >= 1 && tokensRpm >= 1) {
    tokensRps -= 1;
    tokensRpm -= 1;
    return {
      allowed: true,
      nextState: {
        tokensRps,
        lastRps: now,
        tokensRpm,
        lastRpm: now
      }
    };
  }

  // Compute approximate retry-after
  const needRps = Math.max(0, 1 - tokensRps);
  const needRpm = Math.max(0, 1 - tokensRpm);
  const secRps = needRps / (rps || 1);
  const secRpm = (needRpm * 60) / (rpm || 1);
  const retryAfter = Math.ceil(Math.max(secRps, secRpm, 1));

  return {
    allowed: false,
    retryAfterSeconds: retryAfter,
    nextState: {
      tokensRps,
      lastRps: now,
      tokensRpm,
      lastRpm: now
    }
  };
}

async function checkMemoryBucket(
  key: string,
  rps: number,
  rpm: number,
  burst: number
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const existing =
    memoryBuckets.get(key) ??
    {
      tokensRps: burst,
      lastRps: nowSeconds(),
      tokensRpm: rpm,
      lastRpm: nowSeconds()
    };

  const { allowed, retryAfterSeconds, nextState } = consumeFromState(
    existing,
    rps,
    rpm,
    burst
  );
  memoryBuckets.set(key, nextState);
  return { allowed, retryAfterSeconds };
}

async function checkRedisBucket(
  client: any,
  key: string,
  rps: number,
  rpm: number,
  burst: number
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const raw = await client.hGetAll(key);
  const base: BucketState = {
    tokensRps: raw.tokensRps ? parseFloat(raw.tokensRps) : burst,
    lastRps: raw.lastRps ? parseFloat(raw.lastRps) : nowSeconds(),
    tokensRpm: raw.tokensRpm ? parseFloat(raw.tokensRpm) : rpm,
    lastRpm: raw.lastRpm ? parseFloat(raw.lastRpm) : nowSeconds()
  };
  const { allowed, retryAfterSeconds, nextState } = consumeFromState(
    base,
    rps,
    rpm,
    burst
  );
  await client.hSet(key, {
    tokensRps: String(nextState.tokensRps),
    lastRps: String(nextState.lastRps),
    tokensRpm: String(nextState.tokensRpm),
    lastRpm: String(nextState.lastRpm)
  });
  await client.expire(key, 120); // keep buckets short-lived
  return { allowed, retryAfterSeconds };
}

export async function checkAgentRateLimit(params: {
  agentId: string;
  tool: string;
  requestId: string;
  logger: any;
}): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const enabled = !!(await getConfig<boolean>('ratelimit.enabled'));
  if (!enabled) {
    return { allowed: true };
  }

  const rps = (await getConfig<number>('ratelimit.per_agent.rps')) ?? 2;
  const rpm = (await getConfig<number>('ratelimit.per_agent.rpm')) ?? 60;
  const burst = (await getConfig<number>('ratelimit.burst')) ?? 5;
  const keyMode =
    (await getConfig<string>('ratelimit.key_mode')) ?? 'actor_agent_id';

  const baseKey =
    keyMode === 'actor_agent_id' && params.agentId
      ? params.agentId
      : 'anonymous';
  const key = `agent:${baseKey}`;

  const client = await getRedisClient(params.logger);
  if (client) {
    try {
      return await checkRedisBucket(client, key, rps, rpm, burst);
    } catch (err) {
      params.logger.error({ err, key }, 'Redis rate limit check failed, falling back to memory');
    }
  }

  return checkMemoryBucket(key, rps, rpm, burst);
}

