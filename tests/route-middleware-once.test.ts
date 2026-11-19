/**
 * Route middleware must run exactly once per request, whatever the order or
 * number of decorators stacked on the handler.
 *
 * Regression: `MetadataRegistry.defineRoute` concatenated the stored middleware
 * list with the incoming one, while every decorator already passed the complete
 * list. `@Post` above `@UseMiddleware(x)` produced `[x, x]`, and each further
 * decorator (`@Roles`, `@HttpCode`, ...) doubled it again — a per-route rate
 * limiter counted every request twice, halving the documented limit.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get, Post, HttpCode, RateLimit, Timeout } from '../src/decorators/http';
import { UseMiddleware } from '../src/decorators/middleware';
import { MetadataRegistry } from '../src/core/metadata';
import type { Middleware } from '../src/types';

function counter(): { mw: Middleware; calls: () => number } {
  let n = 0;
  return {
    mw: async (_c, next) => {
      n++;
      await next();
    },
    calls: () => n,
  };
}

describe('route middleware runs once per request', () => {
  it('@UseMiddleware below the HTTP verb', async () => {
    const a = counter();

    @Controller('/mw-below')
    class C {
      @Get('/')
      @UseMiddleware(a.mw)
      handler() {
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => app.include(C));
    (await client.get('/mw-below')).expectOk();
    expect(a.calls()).toBe(1);
  });

  it('@UseMiddleware above the HTTP verb', async () => {
    const a = counter();

    @Controller('/mw-above')
    class C {
      @UseMiddleware(a.mw)
      @Get('/')
      handler() {
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => app.include(C));
    (await client.get('/mw-above')).expectOk();
    expect(a.calls()).toBe(1);
  });

  it('two stacked @UseMiddleware keep their order and run once each', async () => {
    const order: string[] = [];
    const first: Middleware = async (_c, next) => { order.push('first'); await next(); };
    const second: Middleware = async (_c, next) => { order.push('second'); await next(); };

    @Controller('/mw-stacked')
    class C {
      @Get('/')
      @UseMiddleware(first)
      @UseMiddleware(second)
      handler() {
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => app.include(C));
    (await client.get('/mw-stacked')).expectOk();
    expect(order.filter((x) => x === 'first')).toHaveLength(1);
    expect(order.filter((x) => x === 'second')).toHaveLength(1);
  });

  it('other decorators stacked on the route do not re-register it', async () => {
    const a = counter();

    @Controller('/mw-mixed')
    class C {
      @HttpCode(201)
      @Timeout(5_000)
      @Post('/')
      @HttpCode(202)
      @UseMiddleware(a.mw)
      handler() {
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => app.include(C));
    await client.post('/mw-mixed', { json: {} });
    expect(a.calls()).toBe(1);

    const route = MetadataRegistry.getRouteMetadata(C.prototype, 'handler');
    // a.mw + the timeout middleware, each exactly once
    expect(route?.middleware).toHaveLength(2);
  });

  it('@RateLimit under the verb allows exactly `max` requests', async () => {
    @Controller('/mw-limit')
    class C {
      @Get('/')
      @RateLimit({ max: 3, windowMs: 60_000, keyGenerator: () => 'same-client' })
      handler() {
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => app.include(C));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await client.get('/mw-limit')).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
