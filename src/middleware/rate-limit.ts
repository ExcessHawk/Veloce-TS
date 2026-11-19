import type { Context, Middleware, RateLimitOptions, RateLimitStore, RateLimitHit } from '../types/index.js';
import { clientIp } from './client-ip.js';
import { getLogger } from '../logging/logger.js';

/** Warn once per process per message (misconfiguration notices, not per-request noise). */
const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  try {
    getLogger().warn(message);
  } catch {
    console.warn(message);
  }
}

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
  // Removed in v4.0.0. Ignoring it silently would change which address a
  // JavaScript caller is limited by, so say so.
  if ((options as { trustProxy?: unknown }).trustProxy !== undefined) {
    throw new TypeError(
      'Rate limit: the `trustProxy` option was removed in v4.0.0 — it read the leftmost X-Forwarded-For entry, ' +
      'which the client controls. Use `trustedProxyHops` (the number of proxies you run in front of the app).'
    );
  }

  const keyBy = options.keyBy ?? 'ip';

  const ipKey = (c: Context): string => {
    const address = clientIp(c, { trustedProxyHops: options.trustedProxyHops });
    if (address) return address;

    // No peer address: every such request would share one counter.
    warnOnce(
      'Rate limit: the client address could not be determined, so all requests share the key "unknown". ' +
      'Set `trustedProxyHops` if the app is behind a proxy, or provide `keyGenerator` / `keyBy`.'
    );
    return 'unknown';
  };

  /** Default key; `null` means "this limiter does not apply to the request". */
  const defaultKey = (c: Context): string | null => {
    if (keyBy === 'ip') return `ip:${ipKey(c)}`;

    const sub = (c.get('auth.user') as { sub?: unknown } | null | undefined)?.sub;
    if (sub !== undefined && sub !== null && sub !== '') return `user:${String(sub)}`;

    return keyBy === 'user' ? null : `ip:${ipKey(c)}`;
  };

  const {
    windowMs = 60000, // 1 minute default
    max = 100, // 100 requests per window default
    store = new MemoryRateLimitStore(windowMs),
    keyGenerator,
    skip
  } = options;

  if (!options.store && typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    warnOnce(
      'Rate limit: using the in-memory store in production. Counters are per process, so with N instances ' +
      'the effective limit is N times `max`. Pass a shared store (RedisRateLimitStore) to enforce it globally.'
    );
  }

  return async (c: Context, next) => {
    if (skip && (await skip(c))) {
      return next();
    }

    const key = keyGenerator ? keyGenerator(c) : defaultKey(c);
    if (key === null) {
      return next();
    }

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
