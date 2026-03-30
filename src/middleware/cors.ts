import type { Context, Middleware, CorsOptions } from '../types';

/**
 * Clave en el contexto Hono donde se guarda una copia de las cabeceras CORS aplicables
 * al request actual. El {@link mergeVeloceCorsHeaders} las fusiona en respuestas de error
 * (`new Response(...)`) que no heredan los `c.header()` del middleware.
 */
export const VELOCE_CORS_HEADERS_KEY = 'veloce:corsHeaders' as const;

export type VeloceCorsHeadersSnapshot = Record<string, string>;

/**
 * Copia las cabeceras CORS calculadas por el middleware en `c` sobre una `Response`
 * (p. ej. errores RFC 9457 o handlers personalizados que devuelvan `Response` nueva).
 */
export function mergeVeloceCorsHeaders(c: Context, response: Response): Response {
  const snap = c.get(VELOCE_CORS_HEADERS_KEY) as VeloceCorsHeadersSnapshot | undefined;
  if (!snap || Object.keys(snap).length === 0) {
    return response;
  }
  const h = new Headers(response.headers);
  for (const [key, value] of Object.entries(snap)) {
    if (value !== undefined && value !== '') {
      h.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}

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

    const snapshot: VeloceCorsHeadersSnapshot = {};

    // Set CORS headers
    if (allowedOrigin) {
      c.header('Access-Control-Allow-Origin', allowedOrigin);
      snapshot['Access-Control-Allow-Origin'] = allowedOrigin;
    }

    if (credentials) {
      c.header('Access-Control-Allow-Credentials', 'true');
      snapshot['Access-Control-Allow-Credentials'] = 'true';
    }

    if (exposedHeaders.length > 0) {
      const exposed = exposedHeaders.join(', ');
      c.header('Access-Control-Expose-Headers', exposed);
      snapshot['Access-Control-Expose-Headers'] = exposed;
    }

    // Handle preflight requests
    if (requestMethod === 'OPTIONS') {
      if (!allowedOrigin) {
        // Origin not allowed — reject preflight
        c.set(VELOCE_CORS_HEADERS_KEY, snapshot);
        return c.body(null, 403);
      }

      c.header('Access-Control-Allow-Methods', methods.join(', '));
      c.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      c.header('Access-Control-Max-Age', maxAge.toString());

      c.set(VELOCE_CORS_HEADERS_KEY, snapshot);
      return c.body(null, 204);
    }

    // Snapshot for error responses thrown after CORS runs (401, 422, 500, …)
    c.set(VELOCE_CORS_HEADERS_KEY, snapshot);

    // Continue to next middleware/handler
    await next();
  };
}
