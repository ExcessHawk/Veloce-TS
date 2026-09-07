import type { Context, Middleware, RateLimitOptions, RateLimitStore, RateLimitHit } from '../types/index.js';

/**
 * In-memory rate-limit store. Suitable for a single instance; for a fleet,
 * supply a shared store (e.g. Redis) via {@link RateLimitOptions.store} so the
 * limit is enforced across processes instead of per-process.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private requests = new Map<string, { count: number; resetTime: number }>();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 60_000) {
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
      // Never keep the process alive just to expire rate-limit buckets.
      // (Previously this registered process SIGTERM/SIGINT listeners, which
      // suppressed Node's default signal handling for the whole application.)
      this.cleanupInterval.unref?.();
    }
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetTime) {
      const resetTime = now + windowMs;
      this.requests.set(key, { count: 1, resetTime });
      return { count: 1, resetTime };
    }

    record.count++;
    return { count: record.count, resetTime: record.resetTime };
  }

  async reset(key: string): Promise<void> {
    this.requests.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  /** Stop the cleanup timer. */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}

/**
 * Redis-backed rate-limit store — shares one counter across every instance.
 * Pass any ioredis-compatible client.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private redis: any, private prefix = 'ratelimit:') {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const redisKey = this.prefix + key;
    const count: number = await this.redis.incr(redisKey);

    if (count === 1) {
      // First request in this window — set the expiry alongside it.
      await this.redis.pexpire(redisKey, windowMs);
      return { count, resetTime: Date.now() + windowMs };
    }

    const ttl: number = await this.redis.pttl(redisKey);
    return {
      count,
      resetTime: Date.now() + (ttl > 0 ? ttl : windowMs),
    };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

/**
 * Create rate limiting middleware.
 * Tracks requests per IP/key and returns 429 when the limit is exceeded.
 */
export function createRateLimitMiddleware(options: RateLimitOptions): Middleware {
  const trustProxy = options.trustProxy === true;

  const {
    windowMs = 60000, // 1 minute default
    max = 100, // 100 requests per window default
    store = new MemoryRateLimitStore(windowMs),
    keyGenerator = (c: Context) => {
      if (trustProxy) {
        // Behind a trusted reverse proxy the forwarded headers are reliable.
        // x-forwarded-for can be a comma-separated list; take the first (leftmost) IP
        const forwarded = c.req.header('x-forwarded-for');
        if (forwarded) {
          return forwarded.split(',')[0].trim();
        }
        const realIp = c.req.header('x-real-ip');
        if (realIp) {
          return realIp;
        }
      }
      // Direct peer IP — not client-spoofable. Available under Bun via the
      // server instance the adapter passes through as env.
      const peer = (c.env as any)?.server?.requestIP?.(c.req.raw);
      if (peer?.address) {
        return peer.address;
      }
      return 'unknown';
    }
  } = options;

  return async (c: Context, next) => {
    const key = keyGenerator(c);
    const { count, resetTime } = await store.hit(key, windowMs);

    c.header('X-RateLimit-Limit', max.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, max - count).toString());
    c.header('X-RateLimit-Reset', new Date(resetTime).toISOString());

    if (count > max) {
      const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      c.header('Retry-After', retryAfter.toString());

      return c.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
          retryAfter
        },
        429
      );
    }

    await next();
  };
}
