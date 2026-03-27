/**
 * Base HTTP exception class
 * All HTTP exceptions should extend this class
 * Provides consistent error response format
 */
export class HTTPException extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'HTTPException';
    
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert exception to JSON format for HTTP response
   * @returns Object with error details
   */
  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * 404 Not Found exception
 * Thrown when a requested resource cannot be found
 */
export class NotFoundException extends HTTPException {
  constructor(message: string = 'Not Found', details?: any) {
    super(404, message, details);
    this.name = 'NotFoundException';
  }

  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * 401 Unauthorized exception
 * Thrown when authentication is required but not provided or invalid
 */
export class UnauthorizedException extends HTTPException {
  constructor(message: string = 'Unauthorized', details?: any) {
    super(401, message, details);
    this.name = 'UnauthorizedException';
  }

  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * 403 Forbidden exception
 * Thrown when user is authenticated but doesn't have permission
 */
export class ForbiddenException extends HTTPException {
  constructor(message: string = 'Forbidden', details?: any) {
    super(403, message, details);
    this.name = 'ForbiddenException';
  }

  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * 400 Bad Request exception
 * Thrown when the request is malformed or invalid
 */
export class BadRequestException extends HTTPException {
  constructor(message: string = 'Bad Request', details?: any) {
    super(400, message, details);
    this.name = 'BadRequestException';
  }

  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * 409 Conflict exception
 * Thrown when the request conflicts with the current state of the resource
 * (e.g. duplicate key, version mismatch)
 */
export class ConflictException extends HTTPException {
  constructor(message: string = 'Conflict', details?: any) {
    super(409, message, details);
    this.name = 'ConflictException';
  }
}

/**
 * 410 Gone exception
 * Thrown when a resource previously existed but has been permanently removed
 */
export class GoneException extends HTTPException {
  constructor(message: string = 'Gone', details?: any) {
    super(410, message, details);
    this.name = 'GoneException';
  }
}

/**
 * 413 Payload Too Large exception
 * Thrown when the request body exceeds the allowed size limit
 */
export class PayloadTooLargeException extends HTTPException {
  constructor(message: string = 'Payload Too Large', details?: any) {
    super(413, message, details);
    this.name = 'PayloadTooLargeException';
  }
}

/**
 * 422 Unprocessable Entity exception
 * Semantic error: the request is well-formed but cannot be processed
 * (distinct from ValidationException which wraps Zod errors)
 */
export class UnprocessableEntityException extends HTTPException {
  constructor(message: string = 'Unprocessable Entity', details?: any) {
    super(422, message, details);
    this.name = 'UnprocessableEntityException';
  }
}

/**
 * 429 Too Many Requests exception
 * Thrown when rate limiting is triggered manually from a handler
 */
export class TooManyRequestsException extends HTTPException {
  constructor(message: string = 'Too Many Requests', details?: any) {
    super(429, message, details);
    this.name = 'TooManyRequestsException';
  }
}

/**
 * 503 Service Unavailable exception
 * Thrown when the service is temporarily unable to handle the request
 * (e.g. dependency down, maintenance mode)
 */
export class ServiceUnavailableException extends HTTPException {
  constructor(message: string = 'Service Unavailable', details?: any) {
    super(503, message, details);
    this.name = 'ServiceUnavailableException';
  }
}
