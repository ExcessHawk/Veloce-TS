import { ZodError } from 'zod';
import { HTTPException } from '../errors/exceptions.js';

/**
 * ValidationException is thrown when Zod validation fails
 * Extends HTTPException with 422 Unprocessable Entity status
 * Provides detailed validation error information
 */
export class ValidationException extends HTTPException {
  constructor(public zodError: ZodError) {
    super(422, 'Validation failed');
    this.name = 'ValidationException';
  }

  /**
   * Converts the validation error to a user-friendly JSON format
   * @returns Object with error message and detailed validation errors
   */
  toJSON() {
    return {
      error: 'Validation Error',
      statusCode: this.statusCode,
      details: this.zodError.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message,
        code: err.code
      }))
    };
  }
}
