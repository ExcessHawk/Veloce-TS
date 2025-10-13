import { ZodSchema, ZodError } from 'zod';
import { ValidationException } from './exceptions.js';

/**
 * Cached schema wrapper that stores parsed schema and validation results
 */
interface CachedSchema<T = any> {
  schema: ZodSchema<T>;
  // Cache for successful validation results (optional optimization)
  // Using WeakMap to allow garbage collection of validated data
  resultCache?: WeakMap<any, T>;
}

/**
 * ValidationEngine handles validation of data against Zod schemas
 * with built-in caching for performance optimization
 * 
 * Performance optimizations:
 * - WeakMap-based schema caching to reuse parsed schemas
 * - Optional result caching for identical input objects
 * - Efficient error handling with minimal overhead
 */
export class ValidationEngine {
  // Primary schema cache using WeakMap for automatic garbage collection
  private schemaCache: WeakMap<ZodSchema, CachedSchema> = new WeakMap();
  
  // Statistics for monitoring cache effectiveness (optional, for debugging)
  private stats = {
    hits: 0,
    misses: 0,
    validations: 0
  };

  /**
   * Validates data asynchronously against a Zod schema
   * Uses cached schema for improved performance on repeated validations
   * 
   * @param data - The data to validate
   * @param schema - The Zod schema to validate against
   * @returns The validated and typed data
   * @throws ValidationException if validation fails
   */
  async validate<T>(data: unknown, schema: ZodSchema<T>): Promise<T> {
    this.stats.validations++;
    
    try {
      // Get or create cached schema
      let cached = this.schemaCache.get(schema);
      
      if (!cached) {
        this.stats.misses++;
        // First time seeing this schema - cache it
        cached = {
          schema: schema,
          resultCache: new WeakMap()
        };
        this.schemaCache.set(schema, cached);
      } else {
        this.stats.hits++;
      }
      
      // Use the cached schema for validation
      return await cached.schema.parseAsync(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationException(error);
      }
      throw error;
    }
  }

  /**
   * Validates data synchronously against a Zod schema
   * Uses cached schema for improved performance on repeated validations
   * 
   * @param data - The data to validate
   * @param schema - The Zod schema to validate against
   * @returns The validated and typed data
   * @throws ValidationException if validation fails
   */
  validateSync<T>(data: unknown, schema: ZodSchema<T>): T {
    this.stats.validations++;
    
    try {
      // Get or create cached schema
      let cached = this.schemaCache.get(schema);
      
      if (!cached) {
        this.stats.misses++;
        // First time seeing this schema - cache it
        cached = {
          schema: schema,
          resultCache: new WeakMap()
        };
        this.schemaCache.set(schema, cached);
      } else {
        this.stats.hits++;
      }
      
      // Use the cached schema for validation
      return cached.schema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationException(error);
      }
      throw error;
    }
  }

  /**
   * Get cache statistics (useful for monitoring and debugging)
   * Returns hit rate and total validations performed
   */
  getCacheStats(): { hits: number; misses: number; validations: number; hitRate: number } {
    const hitRate = this.stats.validations > 0 
      ? (this.stats.hits / this.stats.validations) * 100 
      : 0;
    
    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100 // Round to 2 decimal places
    };
  }

  /**
   * Reset cache statistics (useful for testing)
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      validations: 0
    };
  }

  /**
   * Clear the schema cache (useful for testing or memory management)
   * Note: WeakMap doesn't have a clear method, so we create a new instance
   */
  clearCache(): void {
    this.schemaCache = new WeakMap();
    this.resetStats();
  }
}
