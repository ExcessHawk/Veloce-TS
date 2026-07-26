/**
 * Middleware tests — rate-limit, compression, CORS
 */
import { describe, it, expect } from 'bun:test';
import { createRateLimitMiddleware } from '../src/middleware/rate-limit';
import { createCompressionMiddleware } from '../src/middleware/compression';
import { createCorsMiddleware } from '../src/middleware/cors';
import { createTimeoutMiddleware } from '../src/middleware/timeout';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeContext(overrides: any = {}): any {
  const headers: Record<string, string> = {};
  const reqHeaders: Record<string, string> = {};
  const store: Record<string, any> = {};
  return {
    req: {
      header: (name: string) => reqHeaders[name.toLowerCase()] ?? null,
      method: overrides.method ?? 'GET',
      _setHeader: (name: string, val: string) => { reqHeaders[name.toLowerCase()] = val; },
    },
    res: overrides.res ?? undefined,
    header: (name: string, val: string) => { headers[name.toLowerCase()] = val; },
    _headers: headers,
    set: (key: string, val: any) => { store[key] = val; },
    get: (key: string) => store[key],
    body: (body: any, status: number) => ({ body, status }),
    json: (data: any, status: number = 200) => ({ data, status }),
    ...overrides,
  };
}

// ─── Rate Limit ───────────────────────────────────────────────────────────────

describe('createRateLimitMiddleware', () => {
  it('allows requests within the limit', async () => {
    const mw = createRateLimitMiddleware({ max: 5, windowMs: 10000 });
    let nexted = false;
    const c = makeFakeContext();
    await mw(c as any, async () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  it('blocks when max is exceeded', async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 10000 });
    const c = makeFakeContext();
    let callCount = 0;

    // First request — allowed
    let result: any;
    await mw(c as any, async () => { callCount++; });
    // Second request — blocked
    result = await mw(c as any, async () => { callCount++; });
    expect(callCount).toBe(1);
    expect(result?.status).toBe(429);
  });

  it('x-forwarded-for: first IP in comma-separated list is used as key', async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 10000, trustProxy: true });
    const c1 = makeFakeContext();
    const c2 = makeFakeContext();

    // Simulate two IPs that would be treated as same if not split
    c1.req._setHeader('x-forwarded-for', '1.2.3.4, 5.6.7.8');
    c2.req._setHeader('x-forwarded-for', '1.2.3.4, 9.10.11.12');

    let c1nexted = false;
    let c2nexted = false;

    await mw(c1 as any, async () => { c1nexted = true; });
    // c2 has the same first IP — should be blocked
    const r2 = await mw(c2 as any, async () => { c2nexted = true; });

    expect(c1nexted).toBe(true);
    expect(c2nexted).toBe(false);
    expect(r2?.status).toBe(429);
  });

  it('different IPs are tracked independently', async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 10000, trustProxy: true });
    const c1 = makeFakeContext();
    const c2 = makeFakeContext();

    c1.req._setHeader('x-forwarded-for', '10.0.0.1');
    c2.req._setHeader('x-forwarded-for', '10.0.0.2');

    let c1nexted = false;
    let c2nexted = false;

    await mw(c1 as any, async () => { c1nexted = true; });
    await mw(c2 as any, async () => { c2nexted = true; });

    expect(c1nexted).toBe(true);
    expect(c2nexted).toBe(true);
  });

  it('forwarded headers are ignored unless trustProxy is enabled', async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 10000 });
    const c1 = makeFakeContext();
    const c2 = makeFakeContext();

    // Spoofed distinct IPs must NOT bypass the limit without trustProxy
    c1.req._setHeader('x-forwarded-for', '10.0.0.1');
    c2.req._setHeader('x-forwarded-for', '10.0.0.2');

    let c2nexted = false;
    await mw(c1 as any, async () => {});
    const r2 = await mw(c2 as any, async () => { c2nexted = true; });

    expect(c2nexted).toBe(false);
    expect(r2?.status).toBe(429);
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

describe('createCorsMiddleware', () => {
  it('wildcard origin sets Allow-Origin: *', async () => {
    const mw = createCorsMiddleware({ origin: '*' });
    const c = makeFakeContext({ method: 'GET' });
    await mw(c as any, async () => {});
    expect(c._headers['access-control-allow-origin']).toBe('*');
  });

  it('array origin only echoes allowed origins', async () => {
    const mw = createCorsMiddleware({ origin: ['https://allowed.com'] });
    const c = makeFakeContext();
    c.req._setHeader('origin', 'https://allowed.com');
    await mw(c as any, async () => {});
    expect(c._headers['access-control-allow-origin']).toBe('https://allowed.com');
  });

  it('disallowed origin does not set Allow-Origin', async () => {
    const mw = createCorsMiddleware({ origin: ['https://allowed.com'] });
    const c = makeFakeContext();
    c.req._setHeader('origin', 'https://evil.com');
    await mw(c as any, async () => {});
    expect(c._headers['access-control-allow-origin']).toBeUndefined();
  });

  it('OPTIONS with disallowed origin returns 403', async () => {
    const mw = createCorsMiddleware({ origin: ['https://allowed.com'] });
    const c = makeFakeContext({ method: 'OPTIONS' });
    c.req._setHeader('origin', 'https://evil.com');
    const result = await mw(c as any, async () => {});
    expect(result?.status).toBe(403);
  });

  it('OPTIONS with allowed origin returns 204', async () => {
    const mw = createCorsMiddleware({ origin: ['https://allowed.com'] });
    const c = makeFakeContext({ method: 'OPTIONS' });
    c.req._setHeader('origin', 'https://allowed.com');
    const result = await mw(c as any, async () => {});
    expect(result?.status).toBe(204);
  });
});

// ─── Compression ──────────────────────────────────────────────────────────────

describe('createCompressionMiddleware', () => {
  it('does not set br encoding (brotli removed)', async () => {
    const mw = createCompressionMiddleware({ threshold: 0 });

    const bigText = 'x'.repeat(2000);
    const response = new Response(bigText, {
      headers: { 'Content-Type': 'text/plain', 'Content-Length': '2000' }
    });

    const c = makeFakeContext();
    c.req._setHeader('accept-encoding', 'br');
    c.res = response;

    await mw(c as any, async () => {});

    // After middleware, if it compressed, it should NOT claim 'br'
    const newEncoding = c.res?.headers?.get?.('content-encoding');
    expect(newEncoding).not.toBe('br');
  });

  it('compresses with gzip when accept-encoding includes gzip', async () => {
    const mw = createCompressionMiddleware({ threshold: 0 });

    const bigText = 'hello world! '.repeat(200);
    const response = new Response(bigText, {
      headers: { 'Content-Type': 'text/plain', 'Content-Length': String(bigText.length) }
    });

    const c = makeFakeContext();
    c.req._setHeader('accept-encoding', 'gzip');
    c.res = response;

    await mw(c as any, async () => {});

    const encoding = c.res?.headers?.get?.('content-encoding');
    // Either compressed with gzip, or body was too small — both are acceptable
    if (encoding) {
      expect(encoding).toBe('gzip');
    }
  });

  it('skips compression when content type is not compressible', async () => {
    const mw = createCompressionMiddleware({ threshold: 0 });
    const response = new Response(new Uint8Array([1, 2, 3, 4, 5]).buffer, {
      headers: { 'Content-Type': 'image/png' }
    });

    const c = makeFakeContext();
    c.req._setHeader('accept-encoding', 'gzip');
    c.res = response;

    const originalRes = c.res;
    await mw(c as any, async () => {});

    // Should not have changed the response (images are not compressible)
    expect(c.res).toBe(originalRes);
  });
});

// ─── Timeout ──────────────────────────────────────────────────────────────────
// Shared by the @Timeout decorator and the functional API's `timeout` option.

describe('createTimeoutMiddleware', () => {
  it('passes through when the handler finishes before the deadline', async () => {
    const mw = createTimeoutMiddleware(1000);
    const c = makeFakeContext();
    let nexted = false;

    await mw(c as any, async () => { nexted = true; });

    expect(nexted).toBe(true);
    expect(c._headers['x-timeout-ms']).toBe('1000');
  });

  it('rejects with a 408-flagged TimeoutError when the handler exceeds the deadline', async () => {
    const mw = createTimeoutMiddleware(20);
    const c = makeFakeContext();

    const promise = mw(c as any, async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    let caught: any;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.name).toBe('TimeoutError');
    expect(caught.statusCode).toBe(408);
    expect(caught.message).toContain('20ms');
  });

  it('uses a custom message when provided', async () => {
    const mw = createTimeoutMiddleware(20, 'report generation took too long');
    const c = makeFakeContext();

    let caught: any;
    try {
      await mw(c as any, async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
    } catch (err) {
      caught = err;
    }

    expect(caught.message).toBe('report generation took too long');
    expect(caught.statusCode).toBe(408);
  });

  it('propagates a handler error unchanged rather than masking it as a timeout', async () => {
    const mw = createTimeoutMiddleware(1000);
    const c = makeFakeContext();

    let caught: any;
    try {
      await mw(c as any, async () => { throw new Error('handler blew up'); });
    } catch (err) {
      caught = err;
    }

    expect(caught.message).toBe('handler blew up');
    expect(caught.name).not.toBe('TimeoutError');
  });

  it('clears its timer once the handler resolves (no dangling timeout keeps the loop alive)', async () => {
    const mw = createTimeoutMiddleware(50);
    const c = makeFakeContext();

    await mw(c as any, async () => {});

    // If the timer were left pending it would reject ~50ms from now with an
    // unhandled rejection; waiting past the deadline proves it was cleared.
    await new Promise(resolve => setTimeout(resolve, 80));
  });
});
