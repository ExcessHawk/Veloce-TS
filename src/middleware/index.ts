/**
 * @module veloce-ts/middleware
 * @description Punto de re-export: CORS, rate limiting, compresión, contexto de request (trace/id) y caché HTTP.
 */
export { createCorsMiddleware } from './cors';
export { createRateLimitMiddleware } from './rate-limit';
export { createCompressionMiddleware } from './compression';
export { 
  createRequestContextMiddleware, 
  createSimpleRequestIdMiddleware,
  type RequestContextMiddlewareOptions 
} from './request-context';
export type { CacheMiddlewareOptions } from './cache';
export { createCacheMiddleware, createCacheInvalidationMiddleware } from './cache';
