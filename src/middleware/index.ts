/**
 * @module veloce-ts/middleware
 * @description Re-export point: CORS, rate limiting, compression, request context (trace/id) and HTTP cache.
 */
export {
  createCorsMiddleware,
  mergeVeloceCorsHeaders,
  VELOCE_CORS_HEADERS_KEY,
  type VeloceCorsHeadersSnapshot,
} from './cors';
export {
  createRateLimitMiddleware,
  MemoryRateLimitStore,
  RedisRateLimitStore,
} from './rate-limit';
export { createCompressionMiddleware } from './compression';
export { createTimeoutMiddleware } from './timeout';
export { 
  createRequestContextMiddleware, 
  createSimpleRequestIdMiddleware,
  type RequestContextMiddlewareOptions 
} from './request-context';
export type { CacheMiddlewareOptions } from './cache';
export { createCacheMiddleware, createCacheInvalidationMiddleware } from './cache';
