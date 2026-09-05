/**
 * @module veloce-ts/cache
 * @description Store types, in-memory and Redis implementations, `CacheManager` and TTL helpers.
 */

// Types
export type { CacheStore, CacheEntry, CacheOptions } from './types';
export { parseTTL } from './types';

// Stores
export { MemoryCacheStore } from './memory-store';
export { RedisCacheStore, createRedisCacheStore, type RedisClient } from './redis-store';

// Manager and utilities
export { 
  CacheManager, 
  getCache, 
  setCache, 
  deleteCache, 
  invalidateCache, 
  clearCache 
} from './manager';

