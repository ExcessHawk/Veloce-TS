/**
 * @module veloce-ts/validation/validator
 * @description {@link ValidationEngine}: runs Zod schemas over body, query, params and headers
 * according to route metadata, normalising failures into {@link ValidationException}.
 */
import { ZodSchema, ZodError } from 'zod';
import { ValidationException } from './exceptions.js';

/**
 * ValidationEngine validates data against Zod schemas and converts Zod errors
 * into the framework's ValidationException (422).
 *
 * Zod schemas are already compiled objects — there is nothing to cache between
 * validations, so this class deliberately holds no schema cache. It only keeps
 * lightweight counters for observability.
 */
export class ValidationEngine {
  private stats = {
    validations: 0,
    failures: 0,
  };

  /**
   * Validates data asynchronously against a Zod schema
   * @throws ValidationException if validation fails
   */
  async validate<T>(data: unknown, schema: ZodSchema<T>): Promise<T> {
    this.stats.validations++;
    try {
      return await schema.parseAsync(data);
    } catch (error) {
      throw this.normalize(error);
    }
  }

  /**
   * Validates data synchronously against a Zod schema
   * @throws ValidationException if validation fails
   */
  validateSync<T>(data: unknown, schema: ZodSchema<T>): T {
    this.stats.validations++;
    try {
      return schema.parse(data);
    } catch (error) {
      throw this.normalize(error);
    }
  }

  /** Wrap Zod errors (also cross-module instances matched by name) into ValidationException. */
  private normalize(error: unknown): unknown {
    if (error instanceof ZodError || (error as any)?.name === 'ZodError') {
      this.stats.failures++;
      return new ValidationException(error as any);
    }
    return error;
  }

  /**
   * Validation counters (useful for monitoring and debugging)
   */
  getStats(): { validations: number; failures: number } {
    return { ...this.stats };
  }

  /**
   * @deprecated There is no schema cache any more; use {@link getStats}. Kept for API
   * compatibility — `hits`/`misses`/`hitRate` are always 0.
   */
  getCacheStats(): { hits: number; misses: number; validations: number; hitRate: number } {
    return { hits: 0, misses: 0, validations: this.stats.validations, hitRate: 0 };
  }

  /**
   * Reset counters (useful for testing)
   */
  resetStats(): void {
    this.stats = { validations: 0, failures: 0 };
  }

  /**
   * @deprecated No cache exists; equivalent to {@link resetStats}.
   */
  clearCache(): void {
    this.resetStats();
  }
}
