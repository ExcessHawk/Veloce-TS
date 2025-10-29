/**
 * Request Context Middleware
 * Automatically initializes request context with UUID and integrates with logging
 */

import type { Context, Middleware } from '../types';
import { initializeRequestContext, cleanupRequestContext, getRequestId, getRequestDuration } from '../context/request-context';
import { getLogger } from '../logging';

export interface RequestContextMiddlewareOptions {
  /**
   * Default timeout for requests in milliseconds
   */
  timeout?: number;
  
  /**
   * Whether to log request start/end
   */
  logging?: boolean;
  
  /**
   * Custom request ID generator
   */
  requestIdGenerator?: () => string;
  
  /**
   * Headers to include in logs
   */
  logHeaders?: string[];
}

/**
 * Create request context middleware
 * 
 * This middleware:
 * - Generates a unique request ID for each request
 * - Sets up AbortSignal for request cancellation
 * - Optionally configures request timeout
 * - Integrates with logging system
 * - Propagates request ID through all logs
 * 
 * @example
 * ```typescript
 * const app = new VeloceTS();
 * 
 * // Basic usage
 * app.use(createRequestContextMiddleware());
 * 
 * // With options
 * app.use(createRequestContextMiddleware({
 *   timeout: 30000, // 30 seconds
 *   logging: true,
 *   logHeaders: ['user-agent', 'referer']
 * }));
 * ```
 */
export function createRequestContextMiddleware(
  options: RequestContextMiddlewareOptions = {}
): Middleware {
  const {
    timeout,
    logging = true,
    requestIdGenerator,
    logHeaders = []
  } = options;

  return async (c: Context, next: () => Promise<void>) => {
    // Generate or extract request ID
    const requestId = requestIdGenerator?.() || 
                     c.req.header('x-request-id') ||
                     undefined;

    // Initialize request context
    const context = initializeRequestContext(c, {
      requestId,
      timeout
    });

    // Create logger with request ID context
    const logger = logging ? getLogger().child({ requestId: context.requestId }) : null;

    // Log request start
    if (logger) {
      const logData: any = {
        method: c.req.method,
        path: c.req.path,
        url: c.req.url
      };

      // Add specified headers to log
      if (logHeaders.length > 0) {
        logData.headers = {};
        for (const headerName of logHeaders) {
          const headerValue = c.req.header(headerName);
          if (headerValue) {
            logData.headers[headerName] = headerValue;
          }
        }
      }

      logger.info('Request started', logData);
    }

    try {
      // Set request ID in response header
      c.header('x-request-id', context.requestId);

      // Execute next middleware/handler
      await next();

      // Log request completion
      if (logger) {
        const duration = getRequestDuration(c);
        logger.info('Request completed', {
          status: c.res.status,
          duration: `${duration}ms`
        });
      }
    } catch (error) {
      // Log request error
      if (logger) {
        const duration = getRequestDuration(c);
        logger.error('Request failed', error as Error, {
          duration: `${duration}ms`
        });
      }
      
      throw error;
    } finally {
      // Clean up request context (clear timeouts, etc.)
      cleanupRequestContext(c);
    }
  };
}

/**
 * Create a simple request ID middleware without logging
 * Useful if you want to manage logging separately
 */
export function createSimpleRequestIdMiddleware(): Middleware {
  return async (c: Context, next: () => Promise<void>) => {
    const requestId = c.req.header('x-request-id') || 
                     initializeRequestContext(c).requestId;
    
    c.header('x-request-id', requestId);
    
    try {
      await next();
    } finally {
      cleanupRequestContext(c);
    }
  };
}

