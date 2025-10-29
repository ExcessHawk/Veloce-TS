/**
 * Cache middleware for functional API routes
 */

import type { Context, Middleware } from '../types';
import type { CacheOptions } from '../cache/types';
import { CacheManager } from '../cache/manager';
import { parseTTL } from '../cache/types';

export interface CacheMiddlewareOptions extends CacheOptions {
  /**
   * Whether to cache only successful responses (2xx)
   */
  onlySuccess?: boolean;
}

/**
 * Create cache middleware for functional API routes
 * 
 * @example
 * ```typescript
 * app.get('/products', {
 *   middleware: [createCacheMiddleware({ ttl: '5m' })],
 *   handler: async () => {
 *     return await db.products.findAll();
 *   }
 * });
 * 
 * // With custom key
 * app.get('/user/:id/posts', {
 *   middleware: [createCacheMiddleware({ 
 *     ttl: 300, 
 *     key: 'user:{id}:posts' 
 *   })],
 *   handler: async (c) => {
 *     const id = c.req.param('id');
 *     return await db.posts.findByUser(id);
 *   }
 * });
 * ```
 */
export function createCacheMiddleware(options: CacheMiddlewareOptions): Middleware {
  const {
    ttl,
    key: customKey,
    prefix,
    includeQuery = false,
    varyByHeaders,
    condition,
    store,
    onlySuccess = true
  } = options;

  const ttlSeconds = parseTTL(ttl);

  return async (c: Context, next: () => Promise<void>) => {
    // Generate cache key
    const method = c.req.method;
    const path = c.req.path;
    const params = c.req.param();
    const query = includeQuery ? c.req.query() : undefined;

    // Add header variations to key
    let headerSuffix = '';
    if (varyByHeaders && varyByHeaders.length > 0) {
      const headerValues = varyByHeaders
        .map(h => `${h}:${c.req.header(h) || ''}`)
        .join('|');
      headerSuffix = `:${headerValues}`;
    }

    const cacheKey = CacheManager.generateKey(
      method,
      path,
      params,
      query,
      { key: customKey, prefix, includeQuery }
    ) + headerSuffix;

    // Try to get from cache
    const cacheStore = store || CacheManager.getDefaultStore();
    const cached = await cacheStore.get(cacheKey);

    if (cached !== null) {
      // Cache hit - return cached response
      c.header('X-Cache', 'HIT');
      return c.json(cached);
    }

    // Cache miss - execute handler
    c.header('X-Cache', 'MISS');

    // Capture the response
    await next();

    // Get the response
    const response = c.res;

    // Check if we should cache this response
    if (onlySuccess && response.status >= 300) {
      return;
    }

    // Try to extract JSON body
    try {
      const clonedResponse = response.clone();
      const body = await clonedResponse.json();

      // Check custom condition
      if (condition && !condition(body)) {
        return;
      }

      // Store in cache
      await cacheStore.set(cacheKey, body, ttlSeconds);
    } catch {
      // Response is not JSON or already consumed, skip caching
    }
  };
}

/**
 * Create cache invalidation middleware
 * Useful for mutations that should clear related cache
 * 
 * @example
 * ```typescript
 * app.post('/products', {
 *   middleware: [createCacheInvalidationMiddleware('products:*')],
 *   handler: async (c) => {
 *     const body = await c.req.json();
 *     return await db.products.create(body);
 *   }
 * });
 * ```
 */
export function createCacheInvalidationMiddleware(
  pattern: string | string[],
  store?: import('../cache/types').CacheStore
): Middleware {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  return async (c: Context, next: () => Promise<void>) => {
    // Execute handler first
    await next();

    // Invalidate cache after successful request
    const cacheStore = store || CacheManager.getDefaultStore();
    
    for (const pat of patterns) {
      // Replace placeholders with actual values from params
      let resolvedPattern = pat;
      const params = c.req.param();
      
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          resolvedPattern = resolvedPattern.replace(`{${key}}`, String(value));
        }
      }

      await cacheStore.deletePattern(resolvedPattern);
    }
  };
}

