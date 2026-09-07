/**
 * @module veloce-ts/cache
 * @description Store types, in-memory and Redis implementations, `CacheManager` and TTL helpers.
 */

// Types
export type { CacheStore, CacheEntry, CacheOptions } from './types.js';
export { parseTTL } from './types.js';

// Stores
export { MemoryCacheStore } from './memory-store.js';
export { RedisCacheStore, createRedisCacheStore, type RedisClient } from './redis-store.js';

// Manager and utilities
export { 
  CacheManager, 
  getCache, 
  setCache, 
  deleteCache, 
  invalidateCache, 
  clearCache 
} from './manager.js';

