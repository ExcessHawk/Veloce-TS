/**
 * Per-request context: id, abort signal, timeout and metadata.
 *
 * Public surface — it backs the `@RequestId()` and `@AbortSignal()` parameter
 * decorators — but it sat at 10% coverage, including the timeout path that
 * cancels in-flight work.
 */
import { describe, it, expect } from 'bun:test';
import type { Context } from 'hono';
import {
  generateRequestId,
  getRequestContext,
  setRequestContext,
  initializeRequestContext,
  getRequestId,
  getAbortSignal,
  abortRequest,
  setRequestMetadata,
  getRequestMetadata,
  getRequestDuration,
  cleanupRequestContext,
} from '../src/context/request-context';

/** Minimal stand-in for Hono's per-request variable bag. */
function fakeContext(): Context {
  const vars = new Map<string, unknown>();
  return {
    get: (key: string) => vars.get(key),
    set: (key: string, value: unknown) => { vars.set(key, value); },
  } as unknown as Context;
}

describe('generateRequestId', () => {
  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 100 }, generateRequestId));
    expect(ids.size).toBe(100);
  });
});

describe('initializeRequestContext', () => {
  it('creates a context reachable from the Hono context', () => {
    const c = fakeContext();
    const context = initializeRequestContext(c);

    expect(context.requestId).toBeTruthy();
    expect(getRequestContext(c)).toBe(context);
    expect(getRequestId(c)).toBe(context.requestId);
  });

  it('honours a caller-supplied request id', () => {
    const c = fakeContext();
    initializeRequestContext(c, { requestId: 'trace-abc' });
    expect(getRequestId(c)).toBe('trace-abc');
  });

  it('exposes an abort signal that starts unaborted', () => {
    const c = fakeContext();
    initializeRequestContext(c);

    const signal = getAbortSignal(c);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
  });

  it('aborts on its own once the timeout elapses', async () => {
    const c = fakeContext();
    initializeRequestContext(c, { timeout: 20 });

    expect(getAbortSignal(c)!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(getAbortSignal(c)!.aborted).toBe(true);
  });

  it('does not arm a timer when no timeout is given', async () => {
    const c = fakeContext();
    const context = initializeRequestContext(c);
    expect(context.timeoutId).toBeUndefined();

    await new Promise((r) => setTimeout(r, 30));
    expect(getAbortSignal(c)!.aborted).toBe(false);
  });
});

describe('without an initialised context', () => {
  it('every accessor answers null rather than throwing', () => {
    const c = fakeContext();
    expect(getRequestContext(c)).toBeNull();
    expect(getRequestId(c)).toBeNull();
    expect(getAbortSignal(c)).toBeNull();
    expect(getRequestDuration(c)).toBeNull();
    expect(getRequestMetadata(c, 'anything')).toBeUndefined();
  });

  it('mutating helpers are no-ops', () => {
    const c = fakeContext();
    expect(() => abortRequest(c)).not.toThrow();
    expect(() => setRequestMetadata(c, 'k', 1)).not.toThrow();
    expect(() => cleanupRequestContext(c)).not.toThrow();
  });
});

describe('abortRequest', () => {
  it('aborts the signal handed to the handler', () => {
    const c = fakeContext();
    initializeRequestContext(c);

    abortRequest(c);
    expect(getAbortSignal(c)!.aborted).toBe(true);
  });
});

describe('request metadata', () => {
  it('round-trips values', () => {
    const c = fakeContext();
    initializeRequestContext(c);

    setRequestMetadata(c, 'tenant', 'acme');
    setRequestMetadata(c, 'attempt', 2);

    expect(getRequestMetadata(c, 'tenant')).toBe('acme');
    expect(getRequestMetadata(c, 'attempt')).toBe(2);
    expect(getRequestMetadata(c, 'missing')).toBeUndefined();
  });
});

describe('getRequestDuration', () => {
  it('reports elapsed milliseconds since the context was created', async () => {
    const c = fakeContext();
    initializeRequestContext(c);

    await new Promise((r) => setTimeout(r, 25));

    const duration = getRequestDuration(c);
    expect(duration).not.toBeNull();
    expect(duration!).toBeGreaterThanOrEqual(20);
  });
});

describe('cleanupRequestContext', () => {
  it('clears the timeout so a finished request cannot abort later', async () => {
    const c = fakeContext();
    initializeRequestContext(c, { timeout: 30 });

    cleanupRequestContext(c);

    await new Promise((r) => setTimeout(r, 60));
    // Without the clear, this signal would have aborted after the handler
    // already returned.
    expect(getAbortSignal(c)?.aborted ?? false).toBe(false);
  });

  it('is safe to call twice', () => {
    const c = fakeContext();
    initializeRequestContext(c, { timeout: 50 });
    cleanupRequestContext(c);
    expect(() => cleanupRequestContext(c)).not.toThrow();
  });
});

describe('setRequestContext', () => {
  it('replaces the stored context', () => {
    const c = fakeContext();
    const first = initializeRequestContext(c, { requestId: 'one' });
    const second = { ...first, requestId: 'two' };

    setRequestContext(c, second);
    expect(getRequestId(c)).toBe('two');
  });
});
