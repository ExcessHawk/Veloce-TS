import type { Context } from '../types';
import { HTTPException } from './exceptions.js';
import { ValidationException } from '../validation/exceptions.js';

/**
 * Custom error handler function type
 * Allows users to provide their own error handling logic
 */
export type CustomErrorHandler = (error: Error, c: Context) => Response | Promise<Response>;

/**
 * ErrorHandler processes all errors that occur during request handling
 * Provides consistent error responses and handles different error types appropriately
 */
export class ErrorHandler {
  private customHandler?: CustomErrorHandler;
  private isDevelopment: boolean;

  constructor(customHandler?: CustomErrorHandler) {
    this.customHandler = customHandler;
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  /**
   * Set a custom error handler
   * @param handler - Custom error handling function
   */
  setCustomHandler(handler: CustomErrorHandler): void {
    this.customHandler = handler;
  }

  /**
   * Main error handling method
   * Processes all error types and returns appropriate HTTP responses
   * @param error - The error that occurred
   * @param c - Hono context object
   * @returns HTTP response with error details
   */
  async handle(error: Error, c: Context): Promise<Response> {
    console.log('ErrorHandler.handle called with:', error.constructor.name, error.message);
    
    // If custom handler is provided, use it first
    if (this.customHandler) {
      try {
        return await this.customHandler(error, c);
      } catch (customHandlerError) {
        // If custom handler fails, fall back to default handling
        console.error('Custom error handler failed:', customHandlerError);
      }
    }

    // Handle ValidationException (422)
    if (error instanceof ValidationException) {
      console.log('Handling as ValidationException');
      return this.handleValidationException(error, c);
    }

    // Handle HTTPException and its subclasses
    if (error instanceof HTTPException) {
      console.log('Handling as HTTPException');
      return this.handleHTTPException(error, c);
    }

    // Handle generic errors (500)
    console.log('Handling as generic error');
    return this.handleGenericError(error, c);
  }

  /**
   * Handle validation exceptions (422 Unprocessable Entity)
   * @param error - ValidationException instance
   * @param c - Hono context
   * @returns JSON response with validation error details
   */
  private handleValidationException(error: ValidationException, c: Context): Response {
    const response = error.toJSON();
    
    // Log validation errors in development
    if (this.isDevelopment) {
      console.error('Validation Error:', {
        path: c.req.path,
        method: c.req.method,
        details: response.details
      });
    }

    return c.json(response, error.statusCode as any);
  }

  /**
   * Handle HTTP exceptions (4xx, 5xx)
   * @param error - HTTPException instance
   * @param c - Hono context
   * @returns JSON response with error details
   */
  private handleHTTPException(error: HTTPException, c: Context): Response {
    const response = error.toJSON();

    // Log HTTP exceptions based on severity
    if (error.statusCode >= 500) {
      // Server errors - always log
      console.error('HTTP Exception:', {
        name: error.name,
        statusCode: error.statusCode,
        message: error.message,
        path: c.req.path,
        method: c.req.method,
        ...(this.isDevelopment && error.stack ? { stack: error.stack } : {})
      });
    } else if (this.isDevelopment) {
      // Client errors - log only in development
      console.warn('HTTP Exception:', {
        name: error.name,
        statusCode: error.statusCode,
        message: error.message,
        path: c.req.path,
        method: c.req.method
      });
    }

    return c.json(response, error.statusCode as any);
  }

  /**
   * Handle generic/unexpected errors (500 Internal Server Error)
   * Hides internal details in production, shows stack trace in development
   * @param error - Generic Error instance
   * @param c - Hono context
   * @returns JSON response with error details
   */
  private handleGenericError(error: Error, c: Context): Response {
    // Always log generic errors
    console.error('Internal Server Error:', {
      name: error.name,
      message: error.message,
      path: c.req.path,
      method: c.req.method,
      stack: error.stack
    });

    // Build response based on environment
    const response: any = {
      error: 'Internal Server Error',
      statusCode: 500
    };

    // In development, include error details and stack trace
    if (this.isDevelopment) {
      response.message = error.message;
      response.name = error.name;
      
      if (error.stack) {
        response.stack = error.stack.split('\n').map(line => line.trim());
      }
    } else {
      // In production, use generic message
      response.message = 'An unexpected error occurred';
    }

    return c.json(response, 500);
  }

  /**
   * Check if running in development mode
   * @returns true if in development mode
   */
  isDevelopmentMode(): boolean {
    return this.isDevelopment;
  }

  /**
   * Set development mode manually (useful for testing)
   * @param isDev - Whether to enable development mode
   */
  setDevelopmentMode(isDev: boolean): void {
    this.isDevelopment = isDev;
  }
}
