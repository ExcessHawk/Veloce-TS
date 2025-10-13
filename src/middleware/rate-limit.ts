import type { Context, Middleware, RateLimitOptions } from '../types';

/**
 * Rate limit record for tracking requests
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * Create rate limiting middleware
 * Tracks requests per IP/key and returns 429 when limit exceeded
 */
export function createRateLimitMiddleware(options: RateLimitOptions): Middleware {
  const {
    windowMs = 60000, // 1 minute default
    max = 100, // 100 requests per window default
    keyGenerator = (c: Context) => {
      // Default: use X-Forwarded-For header or fallback to 'unknown'
      return c.req.header('x-forwarded-for') || 
             c.req.header('x-real-ip') || 
             'unknown';
    }
  } = options;

  // In-memory storage for rate limit records
  const requests = new Map<string, RateLimitRecord>();

  // Cleanup old entries periodically to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests.entries()) {
      if (now > record.resetTime) {
        requests.delete(key);
      }
    }
  }, windowMs);

  // Cleanup on process exit (if supported)
  if (typeof process !== 'undefined' && process.on) {
    process.on('exit', () => clearInterval(cleanupInterval));
  }

  return async (c: Context, next) => {
    const key = keyGenerator(c);
    const now = Date.now();
    const record = requests.get(key);

    if (!record || now > record.resetTime) {
      // New window - reset counter
      requests.set(key, { 
        count: 1, 
        resetTime: now + windowMs 
      });

      // Add rate limit headers
      c.header('X-RateLimit-Limit', max.toString());
      c.header('X-RateLimit-Remaining', (max - 1).toString());
      c.header('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

      await next();
    } else if (record.count < max) {
      // Within limit - increment counter
      record.count++;

      // Add rate limit headers
      c.header('X-RateLimit-Limit', max.toString());
      c.header('X-RateLimit-Remaining', (max - record.count).toString());
      c.header('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

      await next();
    } else {
      // Rate limit exceeded
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      c.header('X-RateLimit-Limit', max.toString());
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
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
  };
}
