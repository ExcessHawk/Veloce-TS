/**
 * @module veloce-ts/errors/exceptions
 * @description HTTP exception hierarchy used by handlers and middleware.
 * All of them extend {@link HTTPException}; when serialized they carry **RFC 9457** fields
 * (`type`, `title`, `status`, `detail`) plus legacy mirrors (`error`, `statusCode`) for
 * compatibility. The `instance` field is added by {@link ErrorHandler}.
 */

import {
  resolveProblemTitle,
  resolveProblemType,
} from './problem-details.js';

/** Options accepted when constructing an {@link HTTPException}. */
export type HTTPExceptionOptions = {
  /**
   * Problem `type` URI (RFC 9457). Defaults to the framework URI for the status code.
   */
  problemType?: string;
  /**
   * Short human-readable `title`. Defaults to the standard title for the status code
   * (e.g. "Not Found"). The error message stays as `detail` for the client.
   */
  title?: string;
};

/**
 * Base HTTP exception. Throw it or extend it for typed 4xx/5xx responses.
 *
 * - `message` -> exposed as `detail` (RFC) and as `error` (legacy).
 * - `details` -> extra data (an extension); in legacy it maps to `details`.*/
export class HTTPException extends Error {
  public readonly problemType?: string;
  public readonly title?: string;

  constructor(
    public statusCode: number,
    message: string,
    public details?: any,
    options?: HTTPExceptionOptions
  ) {
    super(message);
    this.name = 'HTTPException';
    this.problemType = options?.problemType;
    this.title = options?.title;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * JSON representation **without** `instance` (the handler fills it in with the request URL).
   * Includes RFC 9457 fields and legacy aliases.
   */
  toJSON(): Record<string, unknown> {
    const status = this.statusCode;
    const type = resolveProblemType(status, this.problemType);
    const title = resolveProblemTitle(status, this.message, this.title);
    return {
      type,
      title,
      status,
      detail: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
      error: this.message,
      statusCode: status,
    };
  }
}

/** 404 - missing resource or unknown route. */
export class NotFoundException extends HTTPException {
  constructor(message: string = 'Not Found', details?: any) {
    super(404, message, details, { title: 'Not Found' });
    this.name = 'NotFoundException';
  }
}

/** 401 - missing authentication or invalid credentials. */
export class UnauthorizedException extends HTTPException {
  constructor(message: string = 'Unauthorized', details?: any) {
    super(401, message, details, { title: 'Unauthorized' });
    this.name = 'UnauthorizedException';
  }
}

/** 403 - authenticated but not allowed to perform the action. */
export class ForbiddenException extends HTTPException {
  constructor(message: string = 'Forbidden', details?: any) {
    super(403, message, details, { title: 'Forbidden' });
    this.name = 'ForbiddenException';
  }
}

/** 400 - malformed request syntax or parameters (distinct from Zod schema validation). */
export class BadRequestException extends HTTPException {
  constructor(message: string = 'Bad Request', details?: any) {
    super(400, message, details, { title: 'Bad Request' });
    this.name = 'BadRequestException';
  }
}

/** 409 - state conflict (e.g. duplicate, stale version). */
export class ConflictException extends HTTPException {
  constructor(message: string = 'Conflict', details?: any) {
    super(409, message, details, { title: 'Conflict' });
    this.name = 'ConflictException';
  }
}

/** 410 - the resource existed and was permanently removed. */
export class GoneException extends HTTPException {
  constructor(message: string = 'Gone', details?: any) {
    super(410, message, details, { title: 'Gone' });
    this.name = 'GoneException';
  }
}

/** 413 - request body too large. */
export class PayloadTooLargeException extends HTTPException {
  constructor(message: string = 'Payload Too Large', details?: any) {
    super(413, message, details, { title: 'Payload Too Large' });
    this.name = 'PayloadTooLargeException';
  }
}

/**
 * 422 - business/semantic error (not to be confused with {@link ValidationException}, which wraps Zod).
 */
export class UnprocessableEntityException extends HTTPException {
  constructor(message: string = 'Unprocessable Entity', details?: any) {
    super(422, message, details, { title: 'Unprocessable Entity' });
    this.name = 'UnprocessableEntityException';
  }
}

/** 429 - rate limit or another throttling policy. */
export class TooManyRequestsException extends HTTPException {
  constructor(message: string = 'Too Many Requests', details?: any) {
    super(429, message, details, { title: 'Too Many Requests' });
    this.name = 'TooManyRequestsException';
  }
}

/** 503 - dependency down, maintenance, etc. */
export class ServiceUnavailableException extends HTTPException {
  constructor(message: string = 'Service Unavailable', details?: any) {
    super(503, message, details, { title: 'Service Unavailable' });
    this.name = 'ServiceUnavailableException';
  }
}
