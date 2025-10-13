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
