import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'bun:test';
import { createLogger, initializeLogger, getLogger, createChildLogger } from 'veloce-ts';

// Spy on console to verify fallback logger output without polluting test output
function captureConsole(level: 'info' | 'warn' | 'error' | 'debug') {
  const calls: any[][] = [];
  const orig = console[level];
  console[level] = (...args: any[]) => { calls.push(args); };
  return { calls, restore: () => { console[level] = orig; } };
}

describe('createLogger', () => {
  it('returns a logger with info/warn/error/debug/trace/fatal methods', () => {
    const logger = createLogger();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('returns a logger with child() method', () => {
    const logger = createLogger();
    expect(typeof logger.child).toBe('function');
  });

  it('child() returns a logger with the same interface', () => {
    const logger = createLogger();
    const child = logger.child({ module: 'test' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.child).toBe('function');
  });

  it('does not throw when calling info()', () => {
    const logger = createLogger();
    expect(() => logger.info('test message')).not.toThrow();
  });

  it('does not throw when calling warn()', () => {
    const logger = createLogger();
    expect(() => logger.warn('test warning')).not.toThrow();
  });

  it('does not throw when calling error() with Error object', () => {
    const logger = createLogger();
    expect(() => logger.error('test error', new Error('test'))).not.toThrow();
  });

  it('does not throw when calling error() without Error object', () => {
    const logger = createLogger();
    expect(() => logger.error('test error')).not.toThrow();
  });

  it('does not throw when calling fatal()', () => {
    const logger = createLogger();
    expect(() => logger.fatal('fatal', new Error('boom'))).not.toThrow();
  });

  it('does not throw when calling debug()', () => {
    const logger = createLogger();
    expect(() => logger.debug('debug msg', { key: 'val' })).not.toThrow();
  });

  it('does not throw when calling trace()', () => {
    const logger = createLogger();
    expect(() => logger.trace('trace msg')).not.toThrow();
  });
});

describe('initializeLogger / getLogger', () => {
  it('getLogger() returns a logger instance', () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('getLogger() returns same instance on repeated calls', () => {
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
  });

  it('initializeLogger() returns a logger', () => {
    const logger = initializeLogger({ level: 'warn' });
    expect(typeof logger.info).toBe('function');
  });
});

describe('createChildLogger', () => {
  it('returns a logger with context bound', () => {
    const child = createChildLogger({ requestId: 'abc-123' });
    expect(typeof child.info).toBe('function');
  });

  it('child logger does not throw on info()', () => {
    const child = createChildLogger({ service: 'auth' });
    expect(() => child.info('user logged in')).not.toThrow();
  });

  it('child of child does not throw', () => {
    const child = createChildLogger({ service: 'auth' });
    const grandchild = child.child({ userId: 'u1' });
    expect(() => grandchild.warn('suspicious activity')).not.toThrow();
  });
});

describe('Logger with context', () => {
  it('info() with context object does not throw', () => {
    const logger = createLogger();
    expect(() => logger.info('request', { method: 'GET', path: '/api' })).not.toThrow();
  });

  it('warn() with context does not throw', () => {
    const logger = createLogger();
    expect(() => logger.warn('slow query', { duration: 2000 })).not.toThrow();
  });

  it('error() with Error and context does not throw', () => {
    const logger = createLogger();
    expect(() => logger.error('db failed', new Error('timeout'), { query: 'SELECT *' })).not.toThrow();
  });
});
