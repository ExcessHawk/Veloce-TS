/**
 * Logger para Veloce-TS usando Pino
 * 
 * Pino es el logger más rápido para Node.js con excelente rendimiento
 * y formato JSON estructurado ideal para producción.
 */

import type { Logger, LoggerConfig, LogContext } from './types';

// Lazy import para Pino (optional dependency – falls back to console logger if not installed)
let pino: any;

function loadPino(): any | null {
  if (pino !== undefined) return pino;
  try {
    pino = require('pino');
  } catch {
    pino = null; // pino not installed – use console fallback
  }
  return pino;
}

// Implementación de Logger con Pino
class PinoLogger implements Logger {
  private logger: any;

  constructor(config?: LoggerConfig) {
    const pinoLib = loadPino();
    
    const isDev = process.env.NODE_ENV !== 'production';
    const pretty = config?.pretty !== undefined ? config.pretty : isDev;

    if (!pinoLib) {
      // pino is not installed — delegate to the console fallback
      this.logger = new ConsoleLogger(config);
      return;
    }

    this.logger = pinoLib({
      level: config?.level || (isDev ? 'debug' : 'info'),
      transport: pretty ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false
        }
      } : undefined
    });
  }

  trace(message: string, context?: LogContext): void {
    if (this.logger instanceof ConsoleLogger) { this.logger.trace(message, context); return; }
    this.logger.trace(context || {}, message);
  }

  debug(message: string, context?: LogContext): void {
    if (this.logger instanceof ConsoleLogger) { this.logger.debug(message, context); return; }
    this.logger.debug(context || {}, message);
  }

  info(message: string, context?: LogContext): void {
    if (this.logger instanceof ConsoleLogger) { this.logger.info(message, context); return; }
    this.logger.info(context || {}, message);
  }

  warn(message: string, context?: LogContext): void {
    if (this.logger instanceof ConsoleLogger) { this.logger.warn(message, context); return; }
    this.logger.warn(context || {}, message);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (this.logger instanceof ConsoleLogger) { this.logger.error(message, error, context); return; }
    this.logger.error({ err: error, ...context }, message);
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    if (this.logger instanceof ConsoleLogger) { this.logger.fatal(message, error, context); return; }
    this.logger.fatal({ err: error, ...context }, message);
  }

  child(context: LogContext): Logger {
    if (this.logger instanceof ConsoleLogger) return this.logger.child(context);
    return new PinoLoggerWrapper(this.logger.child(context));
  }
}

// Wrapper para child loggers de Pino
class PinoLoggerWrapper implements Logger {
  constructor(private logger: any) {}

  trace(message: string, context?: LogContext): void {
    this.logger.trace(context || {}, message);
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(context || {}, message);
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(context || {}, message);
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(context || {}, message);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.logger.error({ err: error, ...context }, message);
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    this.logger.fatal({ err: error, ...context }, message);
  }

  child(context: LogContext): Logger {
    return new PinoLoggerWrapper(this.logger.child(context));
  }
}

/**
 * Simple console-based logger used when pino is not installed.
 * Implements the same Logger interface so the rest of the framework
 * works identically without any changes.
 */
class ConsoleLogger implements Logger {
  private level: string;
  private ctx: LogContext;

  constructor(config?: LoggerConfig, ctx: LogContext = {}) {
    this.level = config?.level || (process.env.NODE_ENV !== 'production' ? 'debug' : 'info');
    this.ctx = ctx;
  }

  private fmt(message: string, context?: LogContext): string {
    const merged = { ...this.ctx, ...context };
    const extra = Object.keys(merged).length ? ' ' + JSON.stringify(merged) : '';
    return `${message}${extra}`;
  }

  trace(message: string, context?: LogContext): void {
    if (['trace'].includes(this.level)) console.debug('[TRACE]', this.fmt(message, context));
  }

  debug(message: string, context?: LogContext): void {
    if (['trace', 'debug'].includes(this.level)) console.debug('[DEBUG]', this.fmt(message, context));
  }

  info(message: string, context?: LogContext): void {
    if (['trace', 'debug', 'info'].includes(this.level)) console.info('[INFO]', this.fmt(message, context));
  }

  warn(message: string, context?: LogContext): void {
    if (['trace', 'debug', 'info', 'warn'].includes(this.level)) console.warn('[WARN]', this.fmt(message, context));
  }

  error(message: string, error?: Error, context?: LogContext): void {
    console.error('[ERROR]', this.fmt(message, context), error ?? '');
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    console.error('[FATAL]', this.fmt(message, context), error ?? '');
  }

  child(context: LogContext): Logger {
    return new ConsoleLogger({ level: this.level } as LoggerConfig, { ...this.ctx, ...context });
  }
}

/**
 * Create a Pino logger instance
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new PinoLogger(config);
}

/**
 * Logger singleton instance
 */
let loggerInstance: Logger | null = null;

/**
 * Initialize the global logger
 */
export function initializeLogger(config?: LoggerConfig): Logger {
  loggerInstance = createLogger(config);
  return loggerInstance;
}

/**
 * Get the global logger instance
 * Defaults to Pino with pretty printing enabled for development
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    const isDev = process.env.NODE_ENV !== 'production';
    loggerInstance = createLogger({ pretty: isDev, level: isDev ? 'debug' : 'info' });
  }
  return loggerInstance;
}

/**
 * Create a child logger with context
 */
export function createChildLogger(context: LogContext): Logger {
  return getLogger().child(context);
}
