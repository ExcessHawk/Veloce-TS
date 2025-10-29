/**
 * Cache system types
 */

/**
 * Cache entry with data and expiration
 */
export interface CacheEntry<T = any> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

/**
 * Cache store interface
 * Implement this interface to create custom cache backends
 */
export interface CacheStore {
  /**
   * Get a value from the cache
   * Returns null if the key doesn't exist or has expired
   */
  get<T = any>(key: string): Promise<T | null>;

  /**
   * Set a value in the cache with optional TTL
   * @param key - Cache key
   * @param value - Value to store
   * @param ttl - Time to live in seconds (0 = no expiration)
   */
  set<T = any>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Delete a value from the cache
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists in the cache
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all values from the cache
   */
  clear(): Promise<void>;

  /**
   * Delete all keys matching a pattern
   * @param pattern - Pattern to match (supports wildcards like 'user:*')
   */
  deletePattern(pattern: string): Promise<number>;

  /**
   * Get all keys matching a pattern
   */
  keys(pattern?: string): Promise<string[]>;
}

/**
 * Cache configuration for decorators and middleware
 */
export interface CacheOptions {
  /**
   * Time to live in seconds
   * Can be a number or a string like '5m', '1h', '1d'
   */
  ttl: number | string;

  /**
   * Cache key
   * Can include placeholders like {id}, {userId}
   * If not provided, generates key from route and params
   */
  key?: string;

  /**
   * Key prefix for namespacing
   */
  prefix?: string;

  /**
   * Whether to include query parameters in cache key
   */
  includeQuery?: boolean;

  /**
   * Whether to vary cache by specific headers
   */
  varyByHeaders?: string[];

  /**
   * Custom condition to determine if response should be cached
   */
  condition?: (result: any) => boolean;

  /**
   * Cache store to use (defaults to global store)
   */
  store?: CacheStore;
}

/**
 * Parse TTL string to seconds
 * Supports: '5s', '5m', '5h', '5d'
 */
export function parseTTL(ttl: number | string): number {
  if (typeof ttl === 'number') {
    return ttl;
  }

  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid TTL format: ${ttl}. Use format like '5s', '5m', '5h', '5d' or a number`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown TTL unit: ${unit}`);
  }
}

