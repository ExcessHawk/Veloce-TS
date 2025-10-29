/**
 * In-memory cache store implementation
 * Suitable for single-instance applications
 * For distributed systems, use Redis store
 */

import type { CacheStore, CacheEntry } from './types';

export class MemoryCacheStore implements CacheStore {
  private cache: Map<string, CacheEntry> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private maxSize: number;

  constructor(options: {
    /**
     * Maximum number of entries (default: 1000)
     * When exceeded, oldest entries are removed (LRU)
     */
    maxSize?: number;
    
    /**
     * Cleanup interval in milliseconds (default: 60000 = 1 minute)
     * Set to 0 to disable automatic cleanup
     */
    cleanupInterval?: number;
  } = {}) {
    this.maxSize = options.maxSize || 1000;

    // Set up automatic cleanup of expired entries
    const intervalMs = options.cleanupInterval ?? 60000;
    if (intervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, intervalMs);
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  async set<T = any>(key: string, value: T, ttl: number = 0): Promise<void> {
    // Check size limit and remove oldest if necessary
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.removeOldest();
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      data: value,
      createdAt: now,
      expiresAt: ttl > 0 ? now + (ttl * 1000) : 0
    };

    this.cache.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // Check if expired
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async deletePattern(pattern: string): Promise<number> {
    const regex = this.patternToRegex(pattern);
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }

    return deleted;
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.cache.keys());
    
    if (!pattern) {
      return allKeys;
    }

    const regex = this.patternToRegex(pattern);
    return allKeys.filter(key => regex.test(key));
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate?: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Remove oldest entry (LRU eviction)
   */
  private removeOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Convert glob pattern to regex
   */
  private patternToRegex(pattern: string): RegExp {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Convert * to .*
    const regex = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regex}$`);
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

