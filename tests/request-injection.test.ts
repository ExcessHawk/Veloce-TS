/**
 * Request-derived values as injectables: custom parameter decorators and
 * provider factories that receive the request context.
 */
import { describe, it, expect, spyOn } from 'bun:test';
import 'reflect-metadata';
import { z } from 'zod';
import type { Context } from 'hono';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get } from '../src/decorators/http';
import { createParamDecorator, Param } from '../src/decorators/params';
import { Depends, Inject } from '../src/decorators/dependencies';
import { DIContainer } from '../src/dependencies/container';
import { getLogger } from '../src/logging/logger';

describe('createParamDecorator', () => {
  const Tenant = createParamDecorator<string | undefined>((c) => c.req.header('X-Tenant'));
  const HeaderOr = createParamDecorator<string, { name: string; fallback: string }>(
    (c, opts) => c.req.header(opts.name) ?? opts.fallback
  );
  const AsyncValue = createParamDecorator<number>(async () => {
    await Promise.resolve();
    return 42;
  });
  const TenantId = createParamDecorator<string | undefined>((c) => c.req.header('X-Tenant'), {
    schema: z.string().uuid(),
  });

  @Controller('/cpd')
  class C {
    @Get('/tenant')
    tenant(@Tenant() tenant: string) {
      return { tenant };
    }

    @Get('/data')
    data(@HeaderOr({ name: 'X-Color', fallback: 'none' }) color: string) {
      return { color };
    }

    @Get('/async')
    asyncValue(@AsyncValue() n: number) {
      return { n };
    }

    @Get('/mixed/:id')
    mixed(@Param('id') id: string, @Tenant() tenant: string, @AsyncValue() n: number) {
      return { id, tenant, n };
    }

    @Get('/validated')
    validated(@TenantId() tenant: string) {
      return { tenant };
    }
  }

  it('injects a value computed from the request', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    const res = await client.get('/cpd/tenant', { headers: { 'X-Tenant': 'acme' } });
    expect(await res.json()).toEqual({ tenant: 'acme' });
  });

  it('passes the decorator argument to the resolver', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect(await (await client.get('/cpd/data')).json()).toEqual({ color: 'none' });
    expect(await (await client.get('/cpd/data', { headers: { 'X-Color': 'teal' } })).json()).toEqual({ color: 'teal' });
  });

  it('awaits an async resolver', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect(await (await client.get('/cpd/async')).json()).toEqual({ n: 42 });
  });

  it('keeps positions when mixed with built-in parameter decorators', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    const res = await client.get('/cpd/mixed/7', { headers: { 'X-Tenant': 'acme' } });
    expect(await res.json()).toEqual({ id: '7', tenant: 'acme', n: 42 });
  });

  it('validates the resolved value when given a schema', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect((await client.get('/cpd/validated', { headers: { 'X-Tenant': 'nope' } })).status).toBe(422);
    const id = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
    expect(await (await client.get('/cpd/validated', { headers: { 'X-Tenant': id } })).json()).toEqual({ tenant: id });
  });

  it('an error thrown by the resolver goes through the normal error handling', async () => {
    const Boom = createParamDecorator(() => {
      throw Object.assign(new Error('nope'), { name: 'Error' });
    });

    @Controller('/cpd-boom')
    class B {
      @Get('/')
      handler(@Boom() _x: unknown) {
        return { ok: true };
      }
    }
    const { client } = await setupTestApp((app) => app.include(B));
    expect((await client.get('/cpd-boom')).status).toBe(500);
  });

  it('refuses to decorate a constructor parameter', () => {
    expect(() => {
      class X {
        constructor(@Tenant() _t: string) {}
      }
      return X;
    }).toThrow(/route handler parameters/);
  });
});

describe('provider factories receive the request context', () => {
  class TenantContext {
    constructor(public readonly id: string, public readonly serial: number) {}
  }

  it('a request-scoped factory is built from the request, once per request', async () => {
    let built = 0;

    @Controller('/pf')
    class C {
      @Get('/')
      handler(@Depends(TenantContext) a: TenantContext, @Depends(TenantContext) b: TenantContext) {
        return { id: a.id, same: a === b, serial: a.serial };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.getContainer().register(TenantContext, {
        scope: 'request',
        factory: ({ c }) => new TenantContext(c!.req.header('X-Tenant') ?? 'none', ++built),
      });
      app.include(C);
    });

    const first = await (await client.get('/pf', { headers: { 'X-Tenant': 'acme' } })).json();
    const second = await (await client.get('/pf', { headers: { 'X-Tenant': 'globex' } })).json();

    expect(first).toEqual({ id: 'acme', same: true, serial: 1 });
    expect(second).toEqual({ id: 'globex', same: true, serial: 2 });
  });

  it('gives the factory the container, to resolve further dependencies', async () => {
    const container = new DIContainer();
    class Config { value = 'cfg'; }
    class Service { constructor(public cfg: Config) {} }

    container.register(Config, { scope: 'singleton' });
    container.register(Service, {
      scope: 'singleton',
      factory: async ({ container: di }) => new Service(await di.resolve(Config)),
    });

    const svc = await container.resolve(Service);
    expect(svc.cfg.value).toBe('cfg');
  });

  it('outside a request the context is undefined', async () => {
    const container = new DIContainer();
    let seen: Context | undefined | 'unset' = 'unset';
    class Thing {}
    container.register(Thing, { scope: 'singleton', factory: ({ c }) => { seen = c; return new Thing(); } });
    await container.resolve(Thing);
    expect(seen).toBeUndefined();
  });

  it('factories that take no argument keep working', async () => {
    const container = new DIContainer();
    class Legacy { tag = 'legacy'; }
    container.register(Legacy, { scope: 'singleton', factory: () => new Legacy() });
    expect((await container.resolve(Legacy)).tag).toBe('legacy');
  });
});

describe('captive dependency', () => {
  async function captureWarnings(run: () => Promise<void>): Promise<string[]> {
    const warnings: string[] = [];
    const spy = spyOn(getLogger(), 'warn').mockImplementation(((msg: string) => {
      warnings.push(String(msg));
    }) as any);
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return warnings;
  }

  it('refuses a singleton controller that injects a request-scoped provider in its constructor', async () => {
    class PerRequest {}

    @Controller('/captive')
    class C {
      constructor(@Inject(PerRequest) private dep: PerRequest) {}

      @Get('/')
      handler() {
        return { ok: Boolean(this.dep) };
      }
    }

    // An error since v4.0.0 (a warning in 3.7–3.9): the controller cannot be
    // built, so the route fails instead of serving one request's instance to all.
    const { app, client } = await setupTestApp((a) => {
      a.getContainer().register(PerRequest, { scope: 'request' });
      a.include(C);
    });
    expect((await client.get('/captive')).status).toBe(500);

    await expect(
      app.getContainer().resolve(C, { scope: 'singleton', context: {} as any })
    ).rejects.toThrow(/Captive dependency: singleton "C" injects request-scoped "PerRequest"/);
  });

  it('a request-scoped provider as a handler parameter is fine', async () => {
    class PerRequest {}

    @Controller('/not-captive')
    class C {
      @Get('/')
      handler(@Depends(PerRequest) dep: PerRequest) {
        return { ok: Boolean(dep) };
      }
    }

    const warnings = await captureWarnings(async () => {
      const { client } = await setupTestApp((app) => {
        app.getContainer().register(PerRequest, { scope: 'request' });
        app.include(C);
      });
      await client.get('/not-captive');
    });

    expect(warnings.filter((w) => w.includes('Captive dependency'))).toHaveLength(0);
  });
});
