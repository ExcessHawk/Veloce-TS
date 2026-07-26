/**
 * @module veloce-ts/middleware/timeout
 * @description Middleware de timeout por ruta: corre el handler contra un temporizador
 * y aborta con 408 si se excede. Compartido por el decorador `@Timeout` y por la
 * opción `timeout` de la API funcional (`app.get(path, { timeout })`).
 */
import type { Middleware } from '../types';

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
