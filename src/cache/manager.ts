/**
 * Cache manager for managing cache stores and providing utilities
 */

import type { CacheStore, CacheOptions } from './types';
import type { Context } from '../types';
import { parseTTL } from './types';
import { MemoryCacheStore } from './memory-store';

/**
 * Global cache manager
 */
export class CacheManager {
  // Created lazily. An eagerly-constructed MemoryCacheStore starts its cleanup
  // setInterval at import time, which keeps the event loop alive — merely
  // importing veloce-ts was enough to stop a short-lived Node script (a CLI, a
  // codegen task) from ever exiting on its own.
  private static defaultStoreInstance: CacheStore | null = null;

  /** The default store, created on first use. */
  private static get defaultStore(): CacheStore {
    if (!this.defaultStoreInstance) {
      this.defaultStoreInstance = new MemoryCacheStore();
    }
    return this.defaultStoreInstance;
  }
  private static stores: Map<string, CacheStore> = new Map();

  /**
   * Reset all stores to their initial state — use in tests between suites.
   * Destroys the previous stores first: MemoryCacheStore holds a cleanup
   * setInterval, and dropping the reference without destroying it leaks the
   * timer (and keeps the event loop alive so the process never exits).
   */
  static reset(): void {
    this.destroyStore(this.defaultStoreInstance);
    for (const store of this.stores.values()) {
      this.destroyStore(store);
    }
    // Left null on purpose: the next access recreates it lazily.
    this.defaultStoreInstance = null;
    this.stores.clear();
  }

  /**
   * Release every store's resources (timers, connections) without replacing
   * them — call on shutdown so pending cleanup intervals don't keep the
   * process alive.
   */
  static destroy(): void {
    this.destroyStore(this.defaultStoreInstance);
    this.defaultStoreInstance = null;
    for (const store of this.stores.values()) {
      this.destroyStore(store);
    }
    this.stores.clear();
  }

  /** Invoke a store's optional destroy() hook, ignoring stores without one. */
  private static destroyStore(store: CacheStore | null | undefined): void {
    const destroyable = store as { destroy?: () => void } | null | undefined;
    if (destroyable && typeof destroyable.destroy === 'function') {
      destroyable.destroy();
    }
  }

  /**
   * Set the default cache store
   */
  static setDefaultStore(store: CacheStore): void {
    this.defaultStoreInstance = store;
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
   * Generate a cache key from route and parameters.
   *
   * IMPORTANT — per-caller isolation: by default the key is derived only from
   * method + path + params (+ query), so two different users hitting the same
   * URL share one entry. For any route whose response depends on the caller,
   * pass `varyByHeaders` (e.g. `['authorization']`) or a `keyGenerator`;
   * otherwise one user's response can be served to another.
   *
   * @param context - Hono context, required to evaluate `varyByHeaders` / `keyGenerator`
   */
  static generateKey(
    method: string,
    path: string,
    params?: Record<string, any>,
    query?: Record<string, any>,
    options?: Pick<CacheOptions, 'key' | 'prefix' | 'includeQuery' | 'varyByHeaders' | 'keyGenerator'>,
    context?: Context
  ): string {
    // A custom generator replaces the whole scheme (prefix still applies).
    if (options?.keyGenerator && context) {
      const custom = options.keyGenerator(context);
      return options.prefix ? `${options.prefix}:${custom}` : custom;
    }

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

    // Vary the key by the listed request headers — this is what keeps a
    // per-user response (Authorization, Cookie, Accept-Language, …) from
    // leaking to another caller.
    if (options?.varyByHeaders?.length && context) {
      const varied = options.varyByHeaders
        .map(name => `${name.toLowerCase()}=${context.req.header(name) ?? ''}`)
        .join('|');
      parts.push(`vary(${varied})`);
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

