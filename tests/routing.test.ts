import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get, Post, Put, Delete, Patch, HttpCode } from '../src/decorators/http';
import { Param, Body, Query } from '../src/decorators/params';
import { z } from 'zod';

// ── Functional API ────────────────────────────────────────────────────────────

describe('Routing – functional API', () => {
  it('responds to GET', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/ping', { handler: () => ({ pong: true }) });
    });

    const res = await client.get('/ping');
    res.expectOk().expectJson({ pong: true });
  });

  it('responds to POST', async () => {
    const { client } = await setupTestApp((app) => {
      app.post('/items', { handler: () => ({ created: true }) });
    });

    const res = await client.post('/items', { json: {} });
    res.expectOk().expectJson({ created: true });
  });

  it('responds to PUT', async () => {
    const { client } = await setupTestApp((app) => {
      app.put('/items/:id', { handler: () => ({ updated: true }) });
    });
    const res = await client.put('/items/1');
    res.expectOk().expectJson({ updated: true });
  });

  it('responds to DELETE', async () => {
    const { client } = await setupTestApp((app) => {
      app.delete('/items/:id', { handler: () => ({ deleted: true }) });
    });
    const res = await client.delete('/items/1');
    res.expectOk().expectJson({ deleted: true });
  });

  it('responds to PATCH', async () => {
    const { client } = await setupTestApp((app) => {
      app.patch('/items/:id', { handler: () => ({ patched: true }) });
    });
    const res = await client.patch('/items/1');
    res.expectOk().expectJson({ patched: true });
  });

  it('returns 404 for unknown route', async () => {
    const { client } = await setupTestApp((_app) => {});
    const res = await client.get('/not-found');
    res.expectNotFound();
  });

  it('reads route params from handler context', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/users/:id', {
        handler: async (c) => ({ id: c.req.param('id') }),
      });
    });

    const res = await client.get('/users/42');
    res.expectOk().expectJson({ id: '42' });
  });

  it('reads query string from handler context', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/search', {
        handler: async (c) => ({ q: c.req.query('q') }),
      });
    });

    const res = await client.get('/search', { query: { q: 'hello' } });
    res.expectOk().expectJson({ q: 'hello' });
  });

  it('supports route groups with a shared prefix', async () => {
    const { client } = await setupTestApp((app) => {
      app.group('/api/v1', () => {
        app.get('/health', { handler: () => ({ ok: true }) });
        app.get('/version', { handler: () => ({ version: '1' }) });
      });
    });

    const health = await client.get('/api/v1/health');
    health.expectOk().expectJson({ ok: true });

    const version = await client.get('/api/v1/version');
    version.expectOk().expectJson({ version: '1' });
  });
});

// ── Decorator (controller) API ────────────────────────────────────────────────

describe('Routing – decorator API', () => {
  it('handles basic @Get on a @Controller', async () => {
    @Controller('/greet')
    class GreetController {
      @Get('/')
      hello() {
        return { message: 'hi' };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(GreetController);
    });

    const res = await client.get('/greet');
    res.expectOk().expectJson({ message: 'hi' });
  });

  it('injects @Param correctly', async () => {
    @Controller('/items')
    class ItemController {
      @Get('/:id')
      getItem(@Param('id') id: string) {
        return { id };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(ItemController);
    });

    const res = await client.get('/items/99');
    res.expectOk().expectJson({ id: '99' });
  });

  it('injects @Query single param', async () => {
    @Controller('/products')
    class ProductController {
      @Get('/')
      list(@Query('category') category: string) {
        return { category };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(ProductController);
    });

    const res = await client.get('/products', { query: { category: 'books' } });
    res.expectOk().expectJson({ category: 'books' });
  });

  it('injects @Body with Zod schema', async () => {
    const CreateSchema = z.object({ name: z.string() });

    @Controller('/things')
    class ThingController {
      @Post('/')
      create(@Body(CreateSchema) data: { name: string }) {
        return { received: data.name };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(ThingController);
    });

    const res = await client.post('/things', { json: { name: 'widget' } });
    res.expectOk().expectJson({ received: 'widget' });
  });

  it('@HttpCode changes the response status', async () => {
  @Controller('/resources')
  class ResourceController {
    // @HttpCode must be above the HTTP-method decorator: decorators run bottom-to-top,
    // so @Post sets the route first, then @HttpCode overlays the status code.
    @HttpCode(201)
    @Post('/')
    create() {
      return { created: true };
    }
  }

    const { client } = await setupTestApp((app) => {
      app.include(ResourceController);
    });

    const res = await client.post('/resources');
    res.expectCreated().expectJson({ created: true });
  });

  it('controller without prefix defaults to /', async () => {
    @Controller()
    class RootController {
      @Get('/root-test')
      test() {
        return { root: true };
      }
    }

    const { client } = await setupTestApp((app) => {
      app.include(RootController);
    });

    const res = await client.get('/root-test');
    res.expectOk().expectJson({ root: true });
  });
});
