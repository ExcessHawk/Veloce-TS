/**
 * @module veloce-ts/errors/handler
 * @description {@link ErrorHandler}: punto central que convierte excepciones en respuestas HTTP.
 * Soporta **RFC 9457** (`application/problem+json`) o formato **legacy** (`error` / `statusCode`), según configuración.
 */

import type { Context } from '../types';
import { HTTPException } from './exceptions.js';
import { ValidationException } from '../validation/exceptions.js';
import { getLogger } from '../logging/logger.js';
import { mergeVeloceCorsHeaders } from '../middleware/cors.js';
import {
  type ErrorResponseFormat,
  resolveProblemTitle,
  resolveProblemType,
  sendErrorResponse,
} from './problem-details.js';

/**
 * Permite sustituir por completo la respuesta ante un error (útil para integrar con otros formatos o loggers).
 */
export type CustomErrorHandler = (error: Error, c: Context) => Response | Promise<Response>;

/**
 * PostgreSQL SQLSTATE codes for "data exception" (class 22) conditions that are
 * caused by malformed client input reaching the driver — a non-UUID/non-numeric
 * value for a typed column, an out-of-range number, a bad datetime. Treated as
 * 400 Bad Request rather than 500. Kept narrow on purpose: only codes that map
 * cleanly to bad input, not every class-22 condition.
 */
const DATA_EXCEPTION_SQLSTATES = new Set<string>([
  '22P02', // invalid_text_representation (e.g. bad uuid / integer text)
  '22003', // numeric_value_out_of_range
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
]);

export type ErrorHandlerOptions = {
  /**
   * `rfc9457` — `Content-Type: application/problem+json` y cuerpo con `type`, `title`, `status`, `detail`, `instance`.
   * `legacy` — JSON `{ error, statusCode, details? }` como en versiones anteriores.
   * @default 'rfc9457'
   */
  errorResponseFormat?: ErrorResponseFormat;
  /** Forzar modo desarrollo (p. ej. en tests) sin depender de NODE_ENV. */
  forceDevelopment?: boolean;
};

/**
 * Procesa errores no capturados en la cadena de middleware/handlers y devuelve una respuesta coherente.
 */
export class ErrorHandler {
  private customHandler?: CustomErrorHandler;
  private isDevelopment: boolean;
  private format: ErrorResponseFormat;

  constructor(customHandler?: CustomErrorHandler, options?: ErrorHandlerOptions) {
    this.customHandler = customHandler;
    this.format = options?.errorResponseFormat ?? 'rfc9457';
    this.isDevelopment =
      options?.forceDevelopment !== undefined
        ? options.forceDevelopment
        : typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
  }

  setCustomHandler(handler: CustomErrorHandler): void {
    this.customHandler = handler;
  }

  /** Formato activo (útil para tests o documentación). */
  getFormat(): ErrorResponseFormat {
    return this.format;
  }

  setErrorResponseFormat(format: ErrorResponseFormat): void {
    this.format = format;
  }

  async handle(error: Error, c: Context): Promise<Response> {
    if (this.customHandler) {
      try {
        const res = await this.customHandler(error, c);
        return mergeVeloceCorsHeaders(c, res);
      } catch (customHandlerError) {
        if (this.isDevelopment) {
          console.error('Custom error handler failed:', customHandlerError);
        }
      }
    }

    if (error instanceof ValidationException) {
      return mergeVeloceCorsHeaders(c, this.handleValidationException(error, c));
    }

    if (error.name === 'ZodError' && Array.isArray((error as any).issues)) {
      const wrapped = new ValidationException(error as any);
      return mergeVeloceCorsHeaders(c, this.handleValidationException(wrapped, c));
    }

    if (error instanceof HTTPException) {
      return mergeVeloceCorsHeaders(c, this.handleHTTPException(error, c));
    }

    // Map SQL "data exception" errors (e.g. a non-UUID value supplied for a
    // uuid column, an out-of-range number) to 400 instead of a generic 500.
    // These are caused by malformed client input reaching the database driver
    // (commonly a bad route/query param), so they are client errors, and a 500
    // here can also leak driver/stack detail under verbose error formats.
    const sqlState = this.extractSqlState(error);
    if (sqlState && DATA_EXCEPTION_SQLSTATES.has(sqlState)) {
      const badRequest = new HTTPException(400, 'Invalid request parameter', undefined, {
        title: 'Bad Request',
      });
      return mergeVeloceCorsHeaders(c, this.handleHTTPException(badRequest, c));
    }

    return mergeVeloceCorsHeaders(c, this.handleGenericError(error, c));
  }

  /**
   * Pull a PostgreSQL SQLSTATE code off an error or its wrapped cause. Drizzle
   * wraps the driver error as `.cause`; node-postgres exposes `.code`.
   */
  private extractSqlState(error: any): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    if (typeof error.code === 'string') return error.code;
    const cause = (error as any).cause;
    if (cause && typeof cause.code === 'string') return cause.code;
    return undefined;
  }

  private handleValidationException(error: ValidationException, c: Context): Response {
    const body = error.toJSON();

    if (this.isDevelopment) {
      console.error('Validation Error:', {
        path: c.req.path,
        method: c.req.method,
        violations: body.violations ?? body.details,
      });
    }

    return sendErrorResponse(c, body, error.statusCode, this.format);
  }

  private handleHTTPException(error: HTTPException, c: Context): Response {
    if (error.statusCode >= 500) {
      const logCtx = {
        name: error.name,
        statusCode: error.statusCode,
        message: error.message,
        path: c.req.path,
        method: c.req.method,
        ...(this.isDevelopment && error.stack ? { stack: error.stack } : {}),
      };
      try {
        getLogger().error('HTTP Server Error', error, logCtx as any);
      } catch {
        console.error('HTTP Exception:', logCtx);
      }
    } else if (this.isDevelopment) {
      const logCtx = {
        name: error.name,
        statusCode: error.statusCode,
        message: error.message,
        path: c.req.path,
        method: c.req.method,
      };
      try {
        getLogger().warn('HTTP Client Error', logCtx as any);
      } catch {
        console.warn('HTTP Exception:', logCtx);
      }
    }

    const body = error.toJSON();
    return sendErrorResponse(c, body, error.statusCode, this.format);
  }

  private handleGenericError(error: Error, c: Context): Response {
    const logCtx = {
      name: error.name,
      message: error.message,
      path: c.req.path,
      method: c.req.method,
      stack: error.stack,
    };
    try {
      getLogger().error('Internal Server Error', error, logCtx as any);
    } catch {
      console.error('Internal Server Error:', logCtx);
    }

    const status = 500;
    const detail = this.isDevelopment
      ? error.message
      : 'An unexpected error occurred.';

    const body: Record<string, unknown> = {
      type: resolveProblemType(status),
      title: resolveProblemTitle(status, error.message, 'Internal Server Error'),
      status,
      detail,
      error: detail,
      statusCode: status,
    };

    if (this.isDevelopment) {
      body.debug = {
        name: error.name,
        message: error.message,
        stack: error.stack
          ? error.stack.split('\n').map((line) => line.trim())
          : undefined,
      };
    }

    if (this.format === 'legacy') {
      const legacy: Record<string, unknown> = {
        error: 'Internal Server Error',
        statusCode: status,
        message: detail,
      };
      if (this.isDevelopment) {
        legacy.name = error.name;
        if (error.stack) {
          legacy.stack = error.stack.split('\n').map((line) => line.trim());
        }
      }
      return c.json(legacy, status as any);
    }

    return sendErrorResponse(c, body, status, this.format);
  }

  isDevelopmentMode(): boolean {
    return this.isDevelopment;
  }

  setDevelopmentMode(isDev: boolean): void {
    this.isDevelopment = isDev;
  }
}
