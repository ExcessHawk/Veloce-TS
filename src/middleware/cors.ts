import type { Context, Middleware, CorsOptions } from '../types';

/**
 * Create CORS middleware with configurable options
 * Handles preflight requests and adds appropriate CORS headers
 */
export function createCorsMiddleware(options?: CorsOptions): Middleware {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization'],
    exposedHeaders = [],
    credentials = false,
    maxAge = 86400 // 24 hours default
  } = options || {};

  return async (c: Context, next) => {
    const requestOrigin = c.req.header('origin');
    const requestMethod = c.req.method;

    // Determine if origin is allowed
    let allowedOrigin: string | null = null;

    if (typeof origin === 'string') {
      allowedOrigin = origin;
    } else if (Array.isArray(origin)) {
      if (requestOrigin && origin.includes(requestOrigin)) {
        allowedOrigin = requestOrigin;
      }
    } else if (typeof origin === 'function') {
      if (requestOrigin && origin(requestOrigin)) {
        allowedOrigin = requestOrigin;
      }
    }

    // Set CORS headers
    if (allowedOrigin) {
      c.header('Access-Control-Allow-Origin', allowedOrigin);
    }

    if (credentials) {
      c.header('Access-Control-Allow-Credentials', 'true');
    }

    if (exposedHeaders.length > 0) {
      c.header('Access-Control-Expose-Headers', exposedHeaders.join(', '));
    }

    // Handle preflight requests
    if (requestMethod === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', methods.join(', '));
      c.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      c.header('Access-Control-Max-Age', maxAge.toString());
      
      return c.body(null, 204);
    }

    // Continue to next middleware/handler
    await next();
  };
}
