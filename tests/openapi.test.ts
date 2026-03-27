/**
 * OpenAPI / Swagger generation tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { VeloceTS } from '../src/core/application';
import { OpenAPIPlugin } from '../src/plugins/openapi';
import { OpenAPIGenerator } from '../src/docs/openapi-generator';
import { z } from 'zod';
import { Controller, Get, Post } from '../src/decorators/http';
import { Body, Param, Query } from '../src/decorators/params';

// ─── Simple schema helper ─────────────────────────────────────────────────────

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
});

// ─── OpenAPIGenerator ─────────────────────────────────────────────────────────

describe('OpenAPIGenerator', () => {
  let app: VeloceTS;

  beforeEach(() => {
    app = new VeloceTS({ title: 'Test API', version: '2.0.0' });
  });

  it('generates a valid openapi 3.0.0 spec', async () => {
    app.get('/ping', { handler: async () => ({ ok: true }), docs: { summary: 'Ping' } });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), {
      title: 'Test API',
      version: '2.0.0',
    });
    const spec = gen.generate();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Test API');
    expect(spec.info.version).toBe('2.0.0');
  });

  it('includes registered routes in paths', async () => {
    app.get('/users', { handler: async () => [], docs: { tags: ['users'], summary: 'List users' } });
    app.post('/users', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema },
      docs: { summary: 'Create user', tags: ['users'] }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    expect(spec.paths['/users']).toBeDefined();
    expect(spec.paths['/users']['get']).toBeDefined();
    expect(spec.paths['/users']['post']).toBeDefined();
  });

  it('converts :param path params to {param} OpenAPI style', async () => {
    app.get('/users/:id', { handler: async (c) => ({ id: c.req.param('id') }) });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    expect(spec.paths['/users/{id}']).toBeDefined();
    expect(spec.paths['/users/{id}']['get']).toBeDefined();
  });

  it('body schema is reflected as requestBody', async () => {
    app.post('/items', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    const post = spec.paths['/items']['post'];
    expect(post.requestBody).toBeDefined();
    expect(post.requestBody.content['application/json']).toBeDefined();
  });

  it('always adds 422 response for every route', async () => {
    app.get('/test', { handler: async () => ({}) });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    const get = spec.paths['/test']['get'];
    expect(get.responses['422']).toBeDefined();
  });

  it('does not include OPTIONS routes in spec', async () => {
    app.get('/test', { handler: async () => ({}) });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    // OPTIONS should be filtered out
    for (const [path, methods] of Object.entries(spec.paths)) {
      expect((methods as any)['options']).toBeUndefined();
    }
  });
});

// ─── OpenAPIPlugin endpoint ───────────────────────────────────────────────────

describe('OpenAPIPlugin', () => {
  it('serves JSON spec at /openapi.json', async () => {
    const app = new VeloceTS({ title: 'Plugin Test', version: '1.0.0' });
    app.usePlugin(new OpenAPIPlugin({ path: '/openapi.json', docsPath: '/docs' }));
    app.get('/hello', { handler: async () => ({ msg: 'hi' }) });
    await app.compile();

    const res = await app.getHono().fetch(
      new Request('http://localhost/openapi.json')
    );
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Plugin Test');
  });

  it('serves Swagger UI HTML at /docs', async () => {
    const app = new VeloceTS({ title: 'Swagger Test', version: '1.0.0' });
    app.usePlugin(new OpenAPIPlugin({ path: '/openapi.json', docsPath: '/docs' }));
    await app.compile();

    const res = await app.getHono().fetch(
      new Request('http://localhost/docs')
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('swagger-ui');
    expect(html).toContain('/openapi.json');
    // Must NOT contain hardcoded localhost URL
    expect(html).not.toContain('http://localhost:3000');
  });

  it('spec URL in Swagger UI uses relative path from plugin config', async () => {
    const app = new VeloceTS();
    app.usePlugin(new OpenAPIPlugin({ path: '/api/spec.json', docsPath: '/api/docs' }));
    await app.compile();

    const res = await app.getHono().fetch(new Request('http://localhost/api/docs'));
    const html = await res.text();
    expect(html).toContain('/api/spec.json');
  });

  it('spec includes /openapi.json and /docs routes themselves', async () => {
    const app = new VeloceTS();
    app.usePlugin(new OpenAPIPlugin({ path: '/openapi.json', docsPath: '/docs' }));
    await app.compile();

    const res = await app.getHono().fetch(new Request('http://localhost/openapi.json'));
    const spec = await res.json();
    // Both doc routes appear in spec under Documentation tag
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/openapi.json');
    expect(paths).toContain('/docs');
  });

  it('title and version from app config propagate to spec', async () => {
    const app = new VeloceTS({ title: 'My App', version: '3.1.4' });
    app.usePlugin(new OpenAPIPlugin());
    await app.compile();

    const res = await app.getHono().fetch(new Request('http://localhost/openapi.json'));
    const spec = await res.json();
    expect(spec.info.title).toBe('My App');
    expect(spec.info.version).toBe('3.1.4');
  });
});
