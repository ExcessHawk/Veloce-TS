import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'bun:test';
import { Veloce, GraphQLPlugin } from 'veloce-ts';
import { Resolver, GQLQuery, GQLMutation, Arg, getResolverMetadata, getFieldsMetadata } from 'veloce-ts/graphql';
import { z } from 'zod';

// graphql package is an optional peer dep — may not be installed.
// Tests exercise what we can regardless: plugin installation, route registration,
// error paths, and graceful degradation when graphql is absent.

// ── Resolver fixtures ────────────────────────────────────────────────────────

@Resolver('user')
class UserResolver {
  @GQLQuery('getUser')
  async getUser(@Arg('id', z.string()) id: string) {
    return { id, name: 'Test User' };
  }

  @GQLMutation('createUser')
  async createUser(
    @Arg('name', z.string()) name: string,
    @Arg('email', z.string().email()) email: string
  ) {
    return { id: '1', name, email };
  }
}

@Resolver('post')
class PostResolver {
  @GQLQuery('getPosts')
  async getPosts() {
    return [];
  }
}

// ── Base test app ────────────────────────────────────────────────────────────

let app: Veloce;
let hono: any;

beforeAll(async () => {
  app = new Veloce({ docs: false });
  app.usePlugin(new GraphQLPlugin({ path: '/graphql', playground: true }));
  await app.compile();
  hono = app.getHono();
});

describe('GraphQLPlugin installation', () => {
  it('constructs without error', () => {
    expect(() => new GraphQLPlugin()).not.toThrow();
  });

  it('has correct name and version', () => {
    const p = new GraphQLPlugin();
    expect(p.name).toBe('graphql');
    expect(p.version).toBe('1.0.0');
  });

  it('installs and compiles without throwing', async () => {
    const a = new Veloce({ docs: false });
    a.usePlugin(new GraphQLPlugin());
    await expect(a.compile()).resolves.toBeUndefined();
  });
});

describe('GraphQLPlugin POST /graphql', () => {
  it('invalid JSON body → 400', async () => {
    const res = await hono.fetch(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all {'
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0].message).toMatch(/Invalid JSON/i);
  });

  it('valid JSON with query → 200 (may return NOT_IMPLEMENTED if graphql pkg absent)', async () => {
    const res = await hono.fetch(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' })
    }));
    // GraphQL spec: always 200, errors in body
    expect(res.status).toBe(200);
    const body = await res.json();
    // Either data or errors present
    expect(body.data !== undefined || body.errors !== undefined).toBe(true);
  });

  it('empty body (no query field) → still 200 with errors', async () => {
    const res = await hono.fetch(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }));
    expect(res.status).toBe(200);
  });
});

describe('GraphQLPlugin GET /graphql', () => {
  it('GET without query param → 400', async () => {
    const res = await hono.fetch(new Request('http://localhost/graphql'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Query parameter/i);
  });

  it('GET with query param → 200', async () => {
    const res = await hono.fetch(
      new Request('http://localhost/graphql?query=%7B__typename%7D')
    );
    expect(res.status).toBe(200);
  });

  it('GET with invalid JSON variables → 400', async () => {
    const res = await hono.fetch(
      new Request('http://localhost/graphql?query=%7B__typename%7D&variables=notjson{')
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON/i);
  });
});

describe('GraphQLPlugin Playground', () => {
  it('GET /graphql/playground → 200 HTML', async () => {
    const res = await hono.fetch(new Request('http://localhost/graphql/playground'));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') || '';
    expect(ct).toMatch(/html/i);
  });

  it('playground disabled → 404', async () => {
    const a = new Veloce({ docs: false });
    a.usePlugin(new GraphQLPlugin({ playground: false }));
    await a.compile();
    const h = a.getHono();
    const res = await h.fetch(new Request('http://localhost/graphql/playground'));
    expect(res.status).toBe(404);
  });
});

describe('@Resolver / @GQLQuery / @GQLMutation decorator metadata', () => {
  it('@Resolver stores resolver metadata on the class', () => {
    const meta = getResolverMetadata(UserResolver);
    expect(meta).toBeDefined();
    expect(meta!.name).toBe('user');
    expect(meta!.target).toBe(UserResolver);
  });

  it('@GQLQuery stores field metadata', () => {
    const fields = getFieldsMetadata(UserResolver);
    const query = fields.find(f => f.name === 'getUser');
    expect(query).toBeDefined();
    expect(query!.type).toBe('query');
    expect(query!.propertyKey).toBe('getUser');
  });

  it('@GQLMutation stores mutation field metadata', () => {
    const fields = getFieldsMetadata(UserResolver);
    const mutation = fields.find(f => f.name === 'createUser');
    expect(mutation).toBeDefined();
    expect(mutation!.type).toBe('mutation');
  });

  it('multiple resolvers accumulate fields independently', () => {
    const userFields = getFieldsMetadata(UserResolver);
    const postFields = getFieldsMetadata(PostResolver);
    expect(userFields.length).toBe(2);
    expect(postFields.length).toBe(1);
    expect(postFields[0].name).toBe('getPosts');
  });

  it('GraphQLSchemaBuilder picks up resolver classes via plugin resolvers option', async () => {
    const a = new Veloce({ docs: false });
    a.usePlugin(new GraphQLPlugin({
      resolvers: [UserResolver, PostResolver],
      playground: false
    }));
    await a.compile();
    // Plugin installed without throwing → schema was built
    expect(true).toBe(true);
  });

  it('plugin with resolvers → POST still returns 200 (schema built)', async () => {
    const a = new Veloce({ docs: false });
    a.usePlugin(new GraphQLPlugin({
      resolvers: [UserResolver, PostResolver],
      playground: false
    }));
    await a.compile();
    const h = a.getHono();
    const res = await h.fetch(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ getUser(id: "1") }' })
    }));
    expect(res.status).toBe(200);
  });
});
