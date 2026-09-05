/**
 * Logging system for Veloce-TS
 *
 * Provides structured logging through Pino when it is installed, falling back
 * to a readable console logger otherwise. Integrates transparently with the
 * framework (request context middleware, ErrorHandler).
 */

export * from './logger';
export * from './middleware';
export * from './types';


