/**
 * @module veloce-ts/middleware
 * @description Re-export point: CORS, rate limiting, compression, request context (trace/id) and HTTP cache.
 */
export {
  createCorsMiddleware,
  mergeVeloceCorsHeaders,
  VELOCE_CORS_HEADERS_KEY,
  type VeloceCorsHeadersSnapshot,
} from './cors.js';
export {
  createRateLimitMiddleware,
  MemoryRateLimitStore,
  RedisRateLimitStore,
} from './rate-limit.js';
export { createCompressionMiddleware } from './compression.js';
export { createTimeoutMiddleware } from './timeout.js';
export { 
  createRequestContextMiddleware, 
  createSimpleRequestIdMiddleware,
  type RequestContextMiddlewareOptions 
} from './request-context.js';
export type { CacheMiddlewareOptions } from './cache.js';
export { createCacheMiddleware, createCacheInvalidationMiddleware } from './cache.js';
