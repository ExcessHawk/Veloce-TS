import { ZodError } from 'zod';
import { HTTPException } from '../errors/exceptions.js';

/**
 * Convert a Zod error path array into a readable string.
 *
 * Rules:
 *  - String segments become dot-separated properties: `user.email`
 *  - Number segments become bracket notation: `items[0].price`
 *
 * @example
 * ['user', 'email']          → 'user.email'
 * ['items', 0, 'price']      → 'items[0].price'
 * [0, 'name']                → '[0].name'
 */
function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '(root)';

  return path.reduce<string>((acc, segment, idx) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    // First string segment — no leading dot
    return idx === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

/**
 * ValidationException is thrown when Zod validation fails.
 * Extends HTTPException with 422 Unprocessable Entity status
 * and provides structured, human-readable validation error details.
 */
export class ValidationException extends HTTPException {
  constructor(public zodError: ZodError) {
    super(422, 'Validation failed');
    this.name = 'ValidationException';
  }

  /**
   * Convert the Zod error to a user-friendly JSON format.
   *
   * Each issue in `details` contains:
   * - `field`   – dot/bracket path to the failing field (e.g. `"items[0].price"`)
   * - `message` – human-readable validation message
   * - `code`    – Zod error code (e.g. `"too_small"`, `"invalid_type"`)
   * - `received`– the actual value type that was received (when available)
   * - `expected`– what was expected (when available)
   */
  toJSON() {
    return {
      error: 'Validation Error',
      statusCode: this.statusCode,
      details: this.zodError.errors.map(err => {
        const detail: Record<string, any> = {
          field:   formatPath(err.path),
          message: err.message,
          code:    err.code,
        };

        // Include type information when present (helps API consumers debug)
        if ('received' in err && err.received !== undefined) {
          detail.received = err.received;
        }
        if ('expected' in err && (err as any).expected !== undefined) {
          detail.expected = (err as any).expected;
        }
        // Include min/max for range errors
        if ('minimum' in err) detail.minimum = (err as any).minimum;
        if ('maximum' in err) detail.maximum = (err as any).maximum;

        return detail;
      }),
    };
  }
}
