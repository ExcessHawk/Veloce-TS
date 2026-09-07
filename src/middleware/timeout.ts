/**
 * @module veloce-ts/middleware/timeout
 * @description Per-route timeout middleware: races the handler against a timer and
 * aborts with 408 when it is exceeded. Shared by the `@Timeout` decorator and the
 * functional API's `timeout` option (`app.get(path, { timeout })`).
 */
import type { Middleware } from '../types/index.js';

/**
 * Create a middleware that races the downstream handler against a timer,
 * rejecting with a 408-flagged TimeoutError when the limit is exceeded.
 * Also sets an `X-Timeout-Ms` response header so clients see the configured
 * limit.
 *
 * @param ms - Timeout in milliseconds
 * @param message - Optional custom error message
 */
export function createTimeoutMiddleware(ms: number, message?: string): Middleware {
  return async (c, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          Object.assign(new Error(message ?? `Request timed out after ${ms}ms`), {
            name: 'TimeoutError',
            statusCode: 408,
          }),
        );
      }, ms);
    });

    try {
      c.header('X-Timeout-Ms', String(ms));
      await Promise.race([next(), timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
