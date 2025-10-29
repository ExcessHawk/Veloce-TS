/**
 * Cache manager for managing cache stores and providing utilities
 */

import type { CacheStore, CacheOptions } from './types';
import { parseTTL } from './types';
import { MemoryCacheStore } from './memory-store';

/**
 * Global cache manager
 */
export class CacheManager {
  private static defaultStore: CacheStore = new MemoryCacheStore();
  private static stores: Map<string, CacheStore> = new Map();

  /**
   * Set the default cache store
   */
  static setDefaultStore(store: CacheStore): void {
    this.defaultStore = store;
  }

  /**
   * Get the default cache store
   */
  static getDefaultStore(): CacheStore {
    return this.defaultStore;
  }

  /**
   * Register a named cache store
   */
  static registerStore(name: string, store: CacheStore): void {
    this.stores.set(name, store);
  }

  /**
   * Get a named cache store
   */
  static getStore(name: string): CacheStore | undefined {
    return this.stores.get(name);
  }

  /**
   * Generate cache key from route and parameters
   */
  static generateKey(
    method: string,
    path: string,
    params?: Record<string, any>,
    query?: Record<string, any>,
    options?: Pick<CacheOptions, 'key' | 'prefix' | 'includeQuery'>
  ): string {
    const parts: string[] = [];

    // Add prefix if provided
    if (options?.prefix) {
      parts.push(options.prefix);
    }

    // Use custom key if provided
    if (options?.key) {
      let key = options.key;
      
      // Replace placeholders like {id}, {userId}
      if (params) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
          key = key.replace(`{${paramKey}}`, String(paramValue));
        }
      }
      
      parts.push(key);
    } else {
      // Generate key from route
      parts.push(method.toLowerCase());
      parts.push(path.replace(/\//g, ':'));

      // Add params to key
      if (params && Object.keys(params).length > 0) {
        parts.push(JSON.stringify(params));
      }
    }

    // Add query parameters if requested
    if (options?.includeQuery && query && Object.keys(query).length > 0) {
      const sortedQuery = Object.keys(query)
        .sort()
        .reduce((acc, key) => {
          acc[key] = query[key];
          return acc;
        }, {} as Record<string, any>);
      parts.push(JSON.stringify(sortedQuery));
    }

    return parts.join(':');
  }

  /**
   * Get value from cache
   */
  static async get<T = any>(
    key: string,
    store?: CacheStore
  ): Promise<T | null> {
    const cacheStore = store || this.defaultStore;
    return await cacheStore.get<T>(key);
  }

  /**
   * Set value in cache
   */
  static async set<T = any>(
    key: string,
    value: T,
    ttl?: number | string,
    store?: CacheStore
  ): Promise<void> {
    const cacheStore = store || this.defaultStore;
    const ttlSeconds = ttl ? parseTTL(ttl) : 0;
    await cacheStore.set(key, value, ttlSeconds);
  }

  /**
   * Delete value from cache
   */
  static async delete(
    key: string,
    store?: CacheStore
  ): Promise<boolean> {
    const cacheStore = store || this.defaultStore;
    return await cacheStore.delete(key);
  }

  /**
   * Delete all keys matching pattern
   */
  static async invalidate(
    pattern: string,
    store?: CacheStore
  ): Promise<number> {
    const cacheStore = store || this.defaultStore;
    return await cacheStore.deletePattern(pattern);
  }

  /**
   * Clear all cache
   */
  static async clear(store?: CacheStore): Promise<void> {
    const cacheStore = store || this.defaultStore;
    await cacheStore.clear();
  }
}

/**
 * Convenience functions for cache operations
 */

/**
 * Get value from cache
 */
export async function getCache<T = any>(key: string): Promise<T | null> {
  return await CacheManager.get<T>(key);
}

/**
 * Set value in cache
 */
export async function setCache<T = any>(
  key: string,
  value: T,
  ttl?: number | string
): Promise<void> {
  await CacheManager.set(key, value, ttl);
}

/**
 * Delete value from cache
 */
export async function deleteCache(key: string): Promise<boolean> {
  return await CacheManager.delete(key);
}

/**
 * Invalidate cache by pattern
 */
export async function invalidateCache(pattern: string): Promise<number> {
  return await CacheManager.invalidate(pattern);
}

/**
 * Clear all cache
 */
export async function clearCache(): Promise<void> {
  await CacheManager.clear();
}

