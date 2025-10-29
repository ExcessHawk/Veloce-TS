/**
 * Logging middleware para Veloce-TS
 */

import type { Context, Middleware } from '../types';
import { createChildLogger } from './logger';

/**
 * Request logging middleware
 * Logs todas las peticiones HTTP con contexto
 */
export function requestLoggingMiddleware(): Middleware {
  return async (c: Context, next: () => Promise<void>) => {
    const logger = createChildLogger({
      context: 'request',
      method: c.req.method,
      path: c.req.path,
      ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
    });

    const start = Date.now();

    logger.info('Incoming request');

    try {
      await next();

      const duration = Date.now() - start;
      logger.info('Request completed', {
        status: c.res.status,
        duration: `${duration}ms`
      });
    } catch (error) {
      const duration = Date.now() - start;
      
      logger.error('Request failed', error as Error, {
        status: (error as any).status || 500,
        duration: `${duration}ms`
      });

      throw error;
    }
  };
}

/**
 * Error logging middleware
 * Captura y loguea errores no manejados
 */
export function errorLoggingMiddleware(): Middleware {
  return async (c: Context, next: () => Promise<void>) => {
    try {
      await next();
    } catch (error) {
      const logger = createChildLogger({ context: 'error' });
      
      logger.error('Unhandled error', error as Error, {
        method: c.req.method,
        path: c.req.path,
        query: c.req.query(),
        headers: Object.fromEntries(new Map(c.req.raw.headers))
      });

      throw error;
    }
  };
}


