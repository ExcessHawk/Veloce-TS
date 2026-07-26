/**
 * Coverage for the five v1.2.0 flagship features that shipped without tests:
 * interceptors, SSE/streaming responses, exception filters, the event bus,
 * and graceful shutdown.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get, Post } from '../src/decorators/http';
import {
  UseInterceptor,
  type Interceptor,
  type ExecutionContext,
} from '../src/core/interceptor-manager';
import { SSE, Stream } from '../src/decorators/stream';
import { Catch, type ExceptionFilter } from '../src/errors/exception-filter';
import { HTTPException } from '../src/errors/exceptions';
import { EventBus } from '../src/events/event-bus';
import { VeloceTS } from '../src/core/application';

// ─── Interceptors ─────────────────────────────────────────────────────────────

describe('Interceptors', () => {
  it('a global interceptor wraps every request and can short-circuit the handler', async () => {
    const log: string[] = [];
    class LoggingInterceptor implements Interceptor {
      async intercept(ctx: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
        log.push(`before:${ctx.handlerName}`);
        const res = await next();
        log.push(`after:${ctx.handlerName}`);
        return res;
      }
    }

    @Controller('/items')
    class ItemController {
      @Get('/')
      list() {
        log.push('handler');
        return { items: [] };
      }
    }

    const { app, client } = await setupTestApp((app) => {
      app.useInterceptor(new LoggingInterceptor());
      app.include(ItemController);
    });

    const res = await client.get('/items');
    res.expectOk();
    expect(log).toEqual(['before:list', 'handler', 'after:list']);
  });

  it('a method-level interceptor (@UseInterceptor) runs only for that route', async () => {
    const calls: string[] = [];
    class MarkerInterceptor implements Interceptor {
      constructor(private name: string) {}
      async intercept(_ctx: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
        calls.push(this.name);
        return next();
      }
    }
    const marker = new MarkerInterceptor('scoped');

    @Controller('/mixed')
    class MixedController {
      @Get('/plain')
      plain() {
        return { ok: true };
      }

      @Get('/scoped')
      @UseInterceptor(marker)
      scoped() {
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(MixedController);
    });

    await client.get('/mixed/plain');
    expect(calls).toEqual([]);

    await client.get('/mixed/scoped');
    expect(calls).toEqual(['scoped']);
  });

  it('an interceptor can short-circuit and prevent the handler from running', async () => {
    let handlerCalled = false;
    class BlockingInterceptor implements Interceptor {
      async intercept(): Promise<Response> {
        return new Response(JSON.stringify({ blocked: true }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    @Controller('/blocked')
    class BlockedController {
      @Get('/')
      @UseInterceptor(new BlockingInterceptor())
      handler() {
        handlerCalled = true;
        return { ok: true };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(BlockedController);
    });

    const res = await client.get('/blocked');
    expect(res.status).toBe(403);
    expect(handlerCalled).toBe(false);
  });
});

// ─── SSE / Streaming ──────────────────────────────────────────────────────────

describe('SSE / Streaming responses', () => {
  it('@SSE streams async-generator output as text/event-stream', async () => {
    @Controller('/events')
    class EventsController {
      @Get('/')
      @SSE()
      async *stream() {
        yield { data: 'first' };
        yield { data: 'second' };
      }
    }

    const { app } = await setupTestApp((app) => {
      app.include(EventsController);
    });

    const res = await app.getHono().request('/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  it('@Stream sends async-generator output with the declared content type', async () => {
    @Controller('/download')
    class DownloadController {
      @Get('/')
      @Stream('application/x-ndjson')
      async *rows() {
        yield '{"n":1}\n';
        yield '{"n":2}\n';
      }
    }

    const { app } = await setupTestApp((app) => {
      app.include(DownloadController);
    });

    const res = await app.getHono().request('/download');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const text = await res.text();
    expect(text).toContain('"n":1');
    expect(text).toContain('"n":2');
  });
});

// ─── Exception filters ────────────────────────────────────────────────────────

describe('Exception filters (@Catch / useFilter)', () => {
  class DomainError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DomainError';
    }
  }

  it('a registered filter handles matching error classes and bypasses the default handler', async () => {
    @Catch(DomainError)
    class DomainErrorFilter implements ExceptionFilter<DomainError> {
      catch(error: DomainError) {
        return new Response(JSON.stringify({ handledBy: 'DomainErrorFilter', message: error.message }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    @Controller('/domain')
    class DomainController {
      @Get('/boom')
      boom() {
        throw new DomainError('validation failed');
      }
    }

    const { client } = await setupTestApp((app) => {
      app.useFilter(new DomainErrorFilter());
      app.include(DomainController);
    });

    const res = await client.get('/domain/boom');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ handledBy: 'DomainErrorFilter', message: 'validation failed' });
  });

  it('non-matching errors fall through to the default error handler', async () => {
    @Catch(DomainError)
    class DomainErrorFilter implements ExceptionFilter<DomainError> {
      catch(error: DomainError) {
        return new Response(JSON.stringify({ handledBy: 'DomainErrorFilter' }), { status: 422 });
      }
    }

    @Controller('/other')
    class OtherController {
      @Get('/boom')
      boom() {
        throw new HTTPException(400, 'plain bad request');
      }
    }

    const { client } = await setupTestApp((app) => {
      app.useFilter(new DomainErrorFilter());
      app.include(OtherController);
    });

    const res = await client.get('/other/boom');
    expect(res.status).toBe(400);
    expect((res.body as any)?.handledBy).toBeUndefined();
  });

  it('the first registered filter matching the error wins over later ones', async () => {
    @Catch(DomainError)
    class FirstFilter implements ExceptionFilter<DomainError> {
      catch() {
        return new Response(JSON.stringify({ handledBy: 'first' }), { status: 418 });
      }
    }
    @Catch(DomainError)
    class SecondFilter implements ExceptionFilter<DomainError> {
      catch() {
        return new Response(JSON.stringify({ handledBy: 'second' }), { status: 418 });
      }
    }

    @Controller('/order')
    class OrderController {
      @Get('/boom')
      boom() {
        throw new DomainError('x');
      }
    }

    const { client } = await setupTestApp((app) => {
      app.useFilter(new FirstFilter());
      app.useFilter(new SecondFilter());
      app.include(OrderController);
    });

    const res = await client.get('/order/boom');
    expect(res.body).toMatchObject({ handledBy: 'first' });
  });
});

// ─── Event bus ────────────────────────────────────────────────────────────────

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('on() + emit() invokes registered listeners with the payload', async () => {
    const received: unknown[] = [];
    bus.on('user.created', (payload) => { received.push(payload); });
    await bus.emit('user.created', { id: 1 });
    expect(received).toEqual([{ id: 1 }]);
  });

  it('once() listeners fire exactly once', async () => {
    let calls = 0;
    bus.once('ping', () => { calls++; });
    await bus.emit('ping');
    await bus.emit('ping');
    expect(calls).toBe(1);
  });

  it('off() removes a listener', async () => {
    let calls = 0;
    const handler = () => { calls++; };
    bus.on('tick', handler);
    bus.off('tick', handler);
    await bus.emit('tick');
    expect(calls).toBe(0);
  });

  it('emit() runs listeners concurrently and rethrows collected errors as AggregateError, without blocking healthy listeners', async () => {
    const ran: string[] = [];
    bus.on('multi', async () => { ran.push('a'); throw new Error('a failed'); });
    bus.on('multi', async () => { ran.push('b'); });

    let caught: unknown;
    try {
      await bus.emit('multi');
    } catch (err) {
      caught = err;
    }

    expect(ran.sort()).toEqual(['a', 'b']);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(1);
  });

  it('emitSync() runs listeners synchronously and rethrows collected errors', () => {
    const ran: string[] = [];
    bus.on('sync-multi', () => { ran.push('a'); throw new Error('boom'); });
    bus.on('sync-multi', () => { ran.push('b'); });

    expect(() => bus.emitSync('sync-multi')).toThrow(AggregateError);
    expect(ran).toEqual(['a', 'b']);
  });

  it('listenerCount() reflects registered handlers', () => {
    expect(bus.listenerCount('x')).toBe(0);
    bus.on('x', () => {});
    bus.on('x', () => {});
    expect(bus.listenerCount('x')).toBe(2);
  });

  it('removeAllListeners(event) clears only that event; no-arg clears everything', async () => {
    let aCalls = 0;
    let bCalls = 0;
    bus.on('a', () => { aCalls++; });
    bus.on('b', () => { bCalls++; });

    bus.removeAllListeners('a');
    await bus.emit('a');
    await bus.emit('b');
    expect(aCalls).toBe(0);
    expect(bCalls).toBe(1);

    bus.removeAllListeners();
    await bus.emit('b');
    expect(bCalls).toBe(1); // unchanged — listener was cleared
  });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

describe('Graceful shutdown (app.shutdown())', () => {
  it('runs onShutdown handlers in reverse registration order', async () => {
    const order: string[] = [];
    const app = new VeloceTS({ docs: false, cors: false });
    app.onShutdown(async () => { order.push('first-registered'); });
    app.onShutdown(async () => { order.push('second-registered'); });
    await app.compile();

    await app.shutdown();

    expect(order).toEqual(['second-registered', 'first-registered']);
  });

  it('an onShutdown handler that throws does not prevent other handlers from running', async () => {
    const order: string[] = [];
    const app = new VeloceTS({ docs: false, cors: false });
    app.onShutdown(async () => { order.push('ok-1'); });
    app.onShutdown(async () => { throw new Error('cleanup failed'); });
    app.onShutdown(async () => { order.push('ok-2'); });
    await app.compile();

    await app.shutdown(); // must not throw despite the failing handler

    expect(order).toEqual(['ok-2', 'ok-1']);
  });

  it('setShutdownTimeout() is chainable and does not affect shutdown() (used only for signal-based shutdown)', async () => {
    const app = new VeloceTS({ docs: false, cors: false });
    const returned = app.setShutdownTimeout(5000);
    expect(returned).toBe(app);
    await app.compile();
    await app.shutdown();
  });

  it('plugin onStop hooks run during app.shutdown(), in reverse install order', async () => {
    const order: string[] = [];
    const app = new VeloceTS({ docs: false, cors: false });

    app.usePlugin({
      name: 'plugin-a',
      install() {},
      onStop: async () => { order.push('a-stopped'); },
    });
    app.usePlugin({
      name: 'plugin-b',
      install() {},
      onStop: async () => { order.push('b-stopped'); },
    });

    await app.compile();
    await app.shutdown();

    expect(order).toEqual(['b-stopped', 'a-stopped']);
  });

  it('plugin onStart hooks run once the server is listening', async () => {
    const started: string[] = [];
    const app = new VeloceTS({ docs: false, cors: false });

    app.usePlugin({
      name: 'starter',
      install() {},
      onStart: async () => { started.push('started'); },
    });

    await app.compile();
    const server = await app.listen(0);
    try {
      expect(started).toEqual(['started']);
    } finally {
      await Promise.resolve(server.close?.());
    }
  });
});
