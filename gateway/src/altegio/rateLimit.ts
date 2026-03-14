// Very small in-memory token bucket suitable for a single-node gateway.
// Altegio public limits are ~5 rps; we keep well below that by default.

const DEFAULT_MAX_TOKENS = 5;
const DEFAULT_REFILL_INTERVAL_MS = 1000;

class TokenBucket {
  private tokens: number;
  private readonly maxTokens: number;

  constructor(maxTokens: number) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;

    setInterval(() => {
      this.tokens = this.maxTokens;
    }, DEFAULT_REFILL_INTERVAL_MS).unref();
  }

  async acquire(): Promise<void> {
    while (this.tokens <= 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.tokens -= 1;
  }
}

const bucket = new TokenBucket(DEFAULT_MAX_TOKENS);

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  await bucket.acquire();
  return fn();
}

