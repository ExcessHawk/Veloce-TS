/**
 * Regression tests for defects found while auditing a real application built
 * on the framework. Each case asserts the corrected behavior.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { z } from 'zod';
import { HTTPException as HonoHTTPException } from 'hono/http-exception';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get } from '../src/decorators/http';
import { Param } from '../src/decorators/params';
import { Depends, Inject } from '../src/decorators/dependencies';
import { DIContainer } from '../src/dependencies/container';
import { ValidationException } from '../src/validation/exceptions';

// ─── Hono's HTTPException keeps its status ───────────────────────────────────

describe("Hono's HTTPException is recognised by the error handler", () => {
  it('thrown from a handler: the status is preserved instead of becoming 500', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/pay', {
        handler: () => {
          throw new HonoHTTPException(402, { message: 'Payment required' });
        },
      });
    });
    const res = await client.get('/pay');
    expect(res.status).toBe(402);
    expect(JSON.stringify(await res.json())).toContain('Payment required');
  });

  it('thrown from a middleware: same', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/gone', {
        middleware: [
          async () => {
            throw new HonoHTTPException(410);
          },
        ],
        handler: () => ({ ok: true }),
      });
    });
    const res = await client.get('/gone');
    expect(res.status).toBe(410);
  });

  it('an ordinary error with a numeric `status` field is still a 500', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/boom', {
        handler: () => {
          throw Object.assign(new Error('upstream said 404'), { status: 404 });
        },
      });
    });
    const res = await client.get('/boom');
    expect(res.status).toBe(500);
  });
});

// ─── DI: the registered scope is the provider's lifetime ─────────────────────

describe('DIContainer: registration scope wins over the injection site', () => {
  class Counter {
    static built = 0;
    constructor() {
      Counter.built++;
    }
  }

  it('a singleton stays a singleton when resolved with a request scope', async () => {
    const container = new DIContainer();
    container.register(Counter, { scope: 'singleton' });
    const ctxA: any = {};
    const ctxB: any = {};
    const a = await container.resolve(Counter, { scope: 'request', context: ctxA });
    const b = await container.resolve(Counter, { scope: 'request', context: ctxB });
    expect(a).toBe(b);
  });

  it('@Depends on a provider registered as singleton does not rebuild it per request', async () => {
    let built = 0;
    class Service {
      id = ++built;
    }

    @Controller('/di-scope')
    class C {
      @Get('/')
      handler(@Depends(Service) svc: Service) {
        return { id: svc.id };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.getContainer().register(Service, { scope: 'singleton', factory: () => new Service() });
      app.include(C);
    });

    const first = await (await client.get('/di-scope')).json();
    const second = await (await client.get('/di-scope')).json();
    expect(first).toEqual({ id: 1 });
    expect(second).toEqual({ id: 1 });
  });

  it('a provider registered without a scope still takes it from the injection site', async () => {
    const container = new DIContainer();
    class Plain {}
    container.register(Plain, { factory: () => new Plain() });
    const a = await container.resolve(Plain, { scope: 'singleton' });
    const b = await container.resolve(Plain, { scope: 'singleton' });
    expect(a).toBe(b);
  });

  it('an unregistered class injected with @Inject is a singleton, as before', async () => {
    let built = 0;
    class Auto {
      id = ++built;
    }

    @Controller('/di-auto')
    class C {
      constructor(@Inject(Auto) private auto: Auto) {}

      @Get('/')
      handler() {
        return { id: this.auto.id };
      }
    }

    const { client } = await setupTestApp((app) => app.include(C));
    await client.get('/di-auto');
    const res = await (await client.get('/di-auto')).json();
    expect(res).toEqual({ id: 1 });
  });
});

// ─── ValidationException reads `issues` ──────────────────────────────────────

describe('ValidationException lists violations from `issues`', () => {
  it('works with an error object that only exposes `issues` (the Zod 4 shape)', () => {
    const zod4Like = {
      name: 'ZodError',
      issues: [{ path: ['email'], message: 'Invalid email', code: 'invalid_format' }],
    };
    const body = new ValidationException(zod4Like as any).toJSON() as any;
    expect(body.violations).toEqual([{ field: 'email', message: 'Invalid email', code: 'invalid_format' }]);
  });

  it('still works with a real Zod 3 error', () => {
    const result = z.object({ age: z.number() }).safeParse({ age: 'x' });
    if (result.success) throw new Error('expected a failure');
    const body = new ValidationException(result.error).toJSON() as any;
    expect(body.violations).toHaveLength(1);
    expect(body.violations[0].field).toBe('age');
  });
});

// ─── @Param with a schema ────────────────────────────────────────────────────

describe('@Param accepts a Zod schema', () => {
  @Controller('/p')
  class C {
    @Get('/one/:id')
    one(@Param('id', z.string().uuid()) id: string) {
      return { id };
    }

    @Get('/all/:year/:month')
    all(
      @Param(z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12) }))
      p: { year: number; month: number }
    ) {
      return p;
    }

    @Get('/plain/:id')
    plain(@Param('id') id: string) {
      return { id };
    }
  }

  it('rejects a malformed value with 422 before the handler runs', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    const res = await client.get('/p/one/not-a-uuid');
    expect(res.status).toBe(422);
  });

  it('passes a valid value through', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    const id = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
    const res = await client.get(`/p/one/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id });
  });

  it('validates and coerces the whole params object', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect(await (await client.get('/p/all/2026/11')).json()).toEqual({ year: 2026, month: 11 });
    expect((await client.get('/p/all/2026/13')).status).toBe(422);
  });

  it('without a schema nothing changes', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect(await (await client.get('/p/plain/anything')).json()).toEqual({ id: 'anything' });
  });
});
