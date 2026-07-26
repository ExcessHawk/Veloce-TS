/**
 * OpenAPI / Swagger generation tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { VeloceTS } from '../src/core/application';
import { OpenAPIPlugin } from '../src/plugins/openapi';
import { OpenAPIGenerator } from '../src/docs/openapi-generator';
import { ZodToJsonSchemaConverter } from '../src/docs/zod-to-json-schema';
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

  it('generates a valid openapi 3.1.0 spec', async () => {
    app.get('/ping', { handler: async () => ({ ok: true }), docs: { summary: 'Ping' } });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), {
      title: 'Test API',
      version: '2.0.0',
    });
    const spec = gen.generate();
    expect(spec.openapi).toBe('3.1.0');
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

// ─── Named component schemas ──────────────────────────────────────────────────

describe('OpenAPIGenerator - named schemas', () => {
  it('derives a stable <Controller><Method><Kind> name for anonymous schemas', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/users', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema },
      docs: { summary: 'Create user' }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    const schemaNames = Object.keys(spec.components!.schemas!);
    // Must NOT fall back to generic Schema1/Schema2 names
    expect(schemaNames.some(n => /^Schema\d+$/.test(n))).toBe(false);
    // Functional routes derive from the FunctionalRoute marker + method key
    expect(schemaNames.some(n => n.includes('Body'))).toBe(true);

    const post = spec.paths['/users']['post'];
    const ref = post.requestBody.content['application/json'].schema.$ref;
    expect(ref).toMatch(/^#\/components\/schemas\//);
    const refName = ref.split('/').pop();
    expect(refName).not.toMatch(/^Schema\d+$/);
  });

  it('uses docs.bodySchemaName as an explicit name hint', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/widgets', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema },
      docs: { bodySchemaName: 'CreateWidgetDto' }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    expect(spec.components!.schemas!['CreateWidgetDto']).toBeDefined();
    const post = spec.paths['/widgets']['post'];
    expect(post.requestBody.content['application/json'].schema.$ref)
      .toBe('#/components/schemas/CreateWidgetDto');
  });

  it('uses a plain-identifier .describe() value as the component name', async () => {
    const NamedSchema = z.object({
      id: z.string(),
      name: z.string(),
      tags: z.array(z.string()),
    }).describe('NamedThing');

    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/things', {
      handler: async (c) => c.req.json(),
      schema: { body: NamedSchema }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    expect(spec.components!.schemas!['NamedThing']).toBeDefined();
  });

  it('flows prose .describe() text into the schema description field (not the name)', async () => {
    const DocumentedSchema = z.object({
      id: z.string(),
      name: z.string(),
      note: z.string(),
    }).describe('A user record with contact details');

    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/documented', {
      handler: async (c) => c.req.json(),
      schema: { body: DocumentedSchema }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();

    const schemaNames = Object.keys(spec.components!.schemas!);
    // Prose description must not become the (invalid) component name
    expect(schemaNames).not.toContain('A user record with contact details');
    const named = schemaNames.find(n => {
      const s = spec.components!.schemas![n];
      return s.description === 'A user record with contact details';
    });
    expect(named).toBeDefined();
  });

  it('sanitizes name hints to [A-Za-z0-9_] and deduplicates colliding names deterministically', () => {
    const spec: any = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} };
    const converter = new ZodToJsonSchemaConverter(spec);

    const schemaA = z.object({ a: z.string(), b: z.string(), c: z.string() });
    const schemaB = z.object({ x: z.number(), y: z.number(), z: z.number() });

    // Same (dirty) name hint for two distinct schemas forces a collision
    const refA = converter.convert(schemaA, { reusable: true, name: 'My Widget!!' });
    const refB = converter.convert(schemaB, { reusable: true, name: 'My Widget!!' });

    const nameA = refA.$ref.split('/').pop();
    const nameB = refB.$ref.split('/').pop();

    expect(nameA).toBe('MyWidget');
    expect(refA.$ref).not.toBe(refB.$ref);
    expect(/^[A-Za-z0-9_]+$/.test(nameA)).toBe(true);
    expect(/^[A-Za-z0-9_]+$/.test(nameB)).toBe(true);
    expect(nameB).toBe(`${nameA}_2`);
  });

  it('has no module-global state: two independent generate() runs produce identical names', async () => {
    const buildSpec = () => {
      const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
      app.post('/users', {
        handler: async (c) => c.req.json(),
        schema: { body: UserSchema }
      });
      return app;
    };

    const app1 = buildSpec();
    await app1.compile();
    const spec1 = new OpenAPIGenerator(app1.getMetadata(), { title: 'API', version: '1.0.0' }).generate();

    const app2 = buildSpec();
    await app2.compile();
    const spec2 = new OpenAPIGenerator(app2.getMetadata(), { title: 'API', version: '1.0.0' }).generate();

    expect(Object.keys(spec1.components!.schemas!)).toEqual(Object.keys(spec2.components!.schemas!));

    const ref1 = spec1.paths['/users']['post'].requestBody.content['application/json'].schema.$ref;
    const ref2 = spec2.paths['/users']['post'].requestBody.content['application/json'].schema.$ref;
    expect(ref1).toBe(ref2);
  });

  it('a fresh converter instance does not inherit names/counter from a prior instance', () => {
    const spec1: any = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} };
    const converter1 = new ZodToJsonSchemaConverter(spec1);
    const anon1 = z.object({ a: z.string(), b: z.string(), c: z.string() });
    const ref1 = converter1.convert(anon1, { reusable: true });

    const spec2: any = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} };
    const converter2 = new ZodToJsonSchemaConverter(spec2);
    const anon2 = z.object({ d: z.string(), e: z.string(), f: z.string() });
    const ref2 = converter2.convert(anon2, { reusable: true });

    // Both instances start their anonymous counter at 1 — no shared/module-global counter
    expect(ref1.$ref).toBe(ref2.$ref);
  });
});

// ─── Examples wiring ──────────────────────────────────────────────────────────

describe('OpenAPIGenerator - examples', () => {
  it('emits a single request example', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/orders', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema },
      docs: {
        examples: { request: { name: 'Ada Lovelace', email: 'ada@example.com' } }
      }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    const mediaType = spec.paths['/orders']['post'].requestBody.content['application/json'];
    expect(mediaType.example).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  it('emits named request examples', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/orders2', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema },
      docs: {
        examples: {
          namedRequest: {
            basic: { summary: 'Basic user', value: { name: 'Ada', email: 'ada@example.com' } }
          }
        }
      }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    const mediaType = spec.paths['/orders2']['post'].requestBody.content['application/json'];
    expect(mediaType.examples.basic.value).toEqual({ name: 'Ada', email: 'ada@example.com' });
  });

  it('emits a per-status response example', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.get('/orders3', {
      handler: async () => ({ id: '1', name: 'Ada' }),
      docs: {
        examples: { responses: { 200: { id: '1', name: 'Ada' } } }
      }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    const mediaType = spec.paths['/orders3']['get'].responses['200'].content['application/json'];
    expect(mediaType.example).toEqual({ id: '1', name: 'Ada' });
  });
});

// ─── Content-type wiring ──────────────────────────────────────────────────────

describe('OpenAPIGenerator - request content types', () => {
  it('defaults to application/json when requestContentType is not set', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/default-ct', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    const content = spec.paths['/default-ct']['post'].requestBody.content;
    expect(content['application/json']).toBeDefined();
    expect(content['multipart/form-data']).toBeUndefined();
  });

  it('emits the configured media type for the request body', async () => {
    const app = new VeloceTS({ title: 'Test API', version: '1.0.0' });
    app.post('/upload', {
      handler: async (c) => c.req.json(),
      schema: { body: UserSchema },
      docs: { requestContentType: 'multipart/form-data' }
    });
    await app.compile();

    const gen = new OpenAPIGenerator(app.getMetadata(), { title: 'API', version: '1.0.0' });
    const spec = gen.generate();
    const content = spec.paths['/upload']['post'].requestBody.content;
    expect(content['multipart/form-data']).toBeDefined();
    expect(content['application/json']).toBeUndefined();
    expect(content['multipart/form-data'].schema).toBeDefined();
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
    expect(spec.openapi).toBe('3.1.0');
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
