/**
 * @module veloce-ts/cache
 * @description Tipos de almacén, implementaciones en memoria y Redis, `CacheManager` y TTL.
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

