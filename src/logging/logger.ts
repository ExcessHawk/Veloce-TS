/**
 * Logger para Veloce-TS usando Pino
 * 
 * Pino es el logger más rápido para Node.js con excelente rendimiento
 * y formato JSON estructurado ideal para producción.
 */

import type { Logger, LoggerConfig, LogContext } from './types';

// Lazy import para Pino
let pino: any;
let pinoPretty: any;

function loadPino() {
  if (!pino) {
    pino = require('pino');
    pinoPretty = require('pino-pretty');
  }
  return { pino, pinoPretty };
}

// Implementación de Logger con Pino
class PinoLogger implements Logger {
  private logger: any;

  constructor(config?: LoggerConfig) {
    const { pino } = loadPino();
    
    const isDev = process.env.NODE_ENV !== 'production';
    const pretty = config?.pretty !== undefined ? config.pretty : isDev;
    
    this.logger = pino({
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
