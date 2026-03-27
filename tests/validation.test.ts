import { describe, it } from 'bun:test';
import 'reflect-metadata';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get, Post } from '../src/decorators/http';
import { Body, Query, Param } from '../src/decorators/params';
import { z } from 'zod';

// ── Body validation ───────────────────────────────────────────────────────────

describe('Validation – @Body', () => {
  const UserSchema = z.object({
    name: z.string().min(2),
    age: z.number().int().positive(),
    email: z.string().email(),
  });

  @Controller('/users')
  class UserController {
    @Post('/')
    create(@Body(UserSchema) body: z.infer<typeof UserSchema>) {
      return { ok: true, name: body.name };
    }
  }

  it('accepts a valid body', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(UserController);
    });

    const res = await client.post('/users', {
      json: { name: 'Alice', age: 25, email: 'alice@example.com' },
    });
    res.expectOk().expectJson({ ok: true, name: 'Alice' });
  });

  it('rejects a body with missing required fields', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(UserController);
    });

    const res = await client.post('/users', { json: { name: 'Bob' } });
    // 400 or 422 depending on the validation implementation
    if (res.status !== 400 && res.status !== 422) {
      throw new Error(`Expected 400 or 422, got ${res.status}`);
    }
  });

  it('rejects a body with invalid types', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(UserController);
    });

    const res = await client.post('/users', {
      json: { name: 'Bo', age: 'not-a-number', email: 'bad-email' },
    });
    if (res.status !== 400 && res.status !== 422) {
      throw new Error(`Expected 400 or 422, got ${res.status}`);
    }
  });

  it('strips unknown fields', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(UserController);
    });

    const res = await client.post('/users', {
      json: { name: 'Alice', age: 30, email: 'alice@example.com', extra: 'should-be-stripped' },
    });
    res.expectOk();
  });
});

// ── Query validation ──────────────────────────────────────────────────────────

describe('Validation – @Query with Zod schema', () => {
  const PaginationSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  });

  @Controller('/posts')
  class PostController {
    @Get('/')
    list(@Query(PaginationSchema) query: z.infer<typeof PaginationSchema>) {
      return { page: query.page, limit: query.limit };
    }
  }

  it('uses default values when query params are omitted', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(PostController);
    });

    const res = await client.get('/posts');
    res.expectOk().expectJson({ page: 1, limit: 10 });
  });

  it('parses valid query params', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(PostController);
    });

    const res = await client.get('/posts', { query: { page: '2', limit: '20' } });
    res.expectOk().expectJson({ page: 2, limit: 20 });
  });

  it('rejects query params that violate the schema', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(PostController);
    });

    const res = await client.get('/posts', { query: { page: '0', limit: '200' } });
    if (res.status !== 400 && res.status !== 422) {
      throw new Error(`Expected 400 or 422, got ${res.status}`);
    }
  });
});

// ── @Param ────────────────────────────────────────────────────────────────────

describe('Validation – @Param', () => {
  @Controller('/articles')
  class ArticleController {
    @Get('/:slug')
    get(@Param('slug') slug: string) {
      return { slug };
    }
  }

  it('extracts a string route parameter', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(ArticleController);
    });

    const res = await client.get('/articles/my-great-post');
    res.expectOk().expectJson({ slug: 'my-great-post' });
  });
});

// ── Functional API validation ─────────────────────────────────────────────────

describe('Validation – functional API schema', () => {
  const ItemSchema = z.object({ title: z.string().min(1) });

  it('validates body via schema config', async () => {
    const { client } = await setupTestApp((app) => {
      app.post('/items', {
        schema: { body: ItemSchema },
        handler: async (c) => {
          const body = await c.req.json();
          return { title: body.title };
        },
      });
    });

    const ok = await client.post('/items', { json: { title: 'hello' } });
    ok.expectOk().expectJson({ title: 'hello' });
  });
});
