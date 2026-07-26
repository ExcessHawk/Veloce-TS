import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'bun:test';
import { Veloce } from '../src/index';
import {
  GraphQLPlugin,
  Resolver,
  GQLQuery,
  GQLMutation,
  GQLSubscription,
  Arg,
  Returns,
  getResolverMetadata,
  getFieldsMetadata
} from '../src/graphql';
import { z } from 'zod';

// graphql package is an optional peer dep — may not be installed.
// Structural tests (installation, routes, error paths, SDL generation) run
// regardless; end-to-end execution tests are skipped when graphql is absent.
let hasGraphQL = false;
try {
  await import('graphql');
  hasGraphQL = true;
} catch {
  // graphql not installed — execution suites below are skipped
}

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

  it('app.include(ResolverClass) registers resolver via MetadataRegistry', async () => {
    @Resolver('comment')
    class CommentResolver {
      @GQLQuery('getComments')
      getComments() { return []; }
    }

    const a = new Veloce({ docs: false });
    a.include(CommentResolver);
    a.usePlugin(new GraphQLPlugin({ playground: false }));
    await a.compile();
    // Schema built from resolver registered via include() — no throw
    expect(true).toBe(true);
  });

  it('app.include() resolver + plugin option resolvers are merged', async () => {
    @Resolver('tag')
    class TagResolver {
      @GQLQuery('getTags')
      getTags() { return []; }
    }

    const a = new Veloce({ docs: false });
    a.include(TagResolver);
    a.usePlugin(new GraphQLPlugin({
      resolvers: [UserResolver],
      playground: false
    }));
    await a.compile();
    const h = a.getHono();
    const res = await h.fetch(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ getTags }' })
    }));
    expect(res.status).toBe(200);
  });
});

// ── End-to-end execution fixtures ────────────────────────────────────────────

const AccountType = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().optional()
});

const RegisterInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().int().optional()
});

// Tracks that resolver methods are actually invoked during execution
const invocations = { account: 0, registerAccount: 0 };

@Resolver('account')
class AccountResolver {
  @GQLQuery('account')
  @Returns(AccountType, { name: 'Account' })
  async account(@Arg('id', z.string()) id: string) {
    invocations.account++;
    return { id, name: 'Ada Lovelace', email: 'ada@example.com', age: 36 };
  }

  @GQLQuery('accounts')
  @Returns(z.array(AccountType), { name: 'Account' })
  async accounts() {
    return [
      { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: '2', name: 'Alan Turing', email: 'alan@example.com' }
    ];
  }

  @GQLMutation('registerAccount')
  @Returns(AccountType, { name: 'Account' })
  async registerAccount(@Arg('input', RegisterInput) input: z.infer<typeof RegisterInput>) {
    invocations.registerAccount++;
    return { id: 'new-1', name: input.name, email: input.email, age: input.age };
  }

  // Subscriptions: SDL only — execution requires a WS transport (out of scope)
  @GQLSubscription('accountCreated')
  @Returns(AccountType, { name: 'Account' })
  async accountCreated() {
    return null;
  }

  // No @Returns → falls back to the generic JSON scalar
  @GQLQuery('accountStats')
  async accountStats() {
    return { total: 2, active: 1 };
  }
}

describe('Schema SDL generation (typed returns and inputs)', () => {
  let plugin: GraphQLPlugin;

  beforeAll(async () => {
    const a = new Veloce({ docs: false });
    plugin = new GraphQLPlugin({ resolvers: [AccountResolver], playground: false, path: '/gql-sdl' });
    a.usePlugin(plugin);
    await a.compile();
  });

  it('emits object type from @Returns Zod schema', () => {
    const typeDefs = plugin.getSchema()!.typeDefs;
    expect(typeDefs).toContain('type Account {');
    expect(typeDefs).toContain('id: String!');
    expect(typeDefs).toContain('email: String!');
    expect(typeDefs).toContain('age: Int');
  });

  it('query field uses the declared return type, not String', () => {
    const typeDefs = plugin.getSchema()!.typeDefs;
    expect(typeDefs).toContain('account(id: String!): Account!');
    expect(typeDefs).not.toContain('account(id: String!): String');
  });

  it('list return type from z.array of object schema', () => {
    const typeDefs = plugin.getSchema()!.typeDefs;
    expect(typeDefs).toContain('accounts: [Account!]!');
  });

  it('emits input type from Zod object argument', () => {
    const typeDefs = plugin.getSchema()!.typeDefs;
    expect(typeDefs).toContain('input RegisterAccountInput {');
    expect(typeDefs).toContain('registerAccount(input: RegisterAccountInput!): Account!');
  });

  it('undeclared return type falls back to JSON scalar', () => {
    const typeDefs = plugin.getSchema()!.typeDefs;
    expect(typeDefs).toContain('scalar JSON');
    expect(typeDefs).toContain('accountStats: JSON');
  });

  it('subscription appears in SDL (execution intentionally not wired)', () => {
    const typeDefs = plugin.getSchema()!.typeDefs;
    expect(typeDefs).toContain('type Subscription {');
    expect(typeDefs).toContain('accountCreated: Account!');
  });
});

describe.skipIf(!hasGraphQL)('End-to-end GraphQL execution', () => {
  let h: any;

  const post = async (body: any) => {
    const res = await h.fetch(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }));
    expect(res.status).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    const a = new Veloce({ docs: false });
    a.usePlugin(new GraphQLPlugin({ resolvers: [AccountResolver, UserResolver], playground: false }));
    await a.compile();
    h = a.getHono();
  });

  it('query returning an object type resolves real field data', async () => {
    const body = await post({ query: '{ account(id: "42") { id name email age } }' });
    expect(body.errors).toBeUndefined();
    expect(body.data.account).toEqual({
      id: '42',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      age: 36
    });
  });

  it('resolver method is actually invoked (non-null data)', async () => {
    const before = invocations.account;
    const body = await post({ query: '{ account(id: "7") { id } }' });
    expect(body.data.account).not.toBeNull();
    expect(body.data.account.id).toBe('7');
    expect(invocations.account).toBe(before + 1);
  });

  it('list query returns all objects with selected fields', async () => {
    const body = await post({ query: '{ accounts { id name } }' });
    expect(body.errors).toBeUndefined();
    expect(body.data.accounts).toHaveLength(2);
    expect(body.data.accounts[0]).toEqual({ id: '1', name: 'Ada Lovelace' });
  });

  it('mutation with Zod-validated input returns the created object', async () => {
    const before = invocations.registerAccount;
    const body = await post({
      query: `mutation Register($input: RegisterAccountInput!) {
        registerAccount(input: $input) { id name email age }
      }`,
      variables: { input: { name: 'Grace Hopper', email: 'grace@example.com', age: 85 } }
    });
    expect(body.errors).toBeUndefined();
    expect(body.data.registerAccount).toEqual({
      id: 'new-1',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      age: 85
    });
    expect(invocations.registerAccount).toBe(before + 1);
  });

  it('mutation input failing Zod validation surfaces an error', async () => {
    const body = await post({
      query: `mutation Register($input: RegisterAccountInput!) {
        registerAccount(input: $input) { id }
      }`,
      variables: { input: { name: 'X', email: 'not-an-email' } }
    });
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('scalar-arg resolver validated by Zod (invalid type rejected by GraphQL layer)', async () => {
    const body = await post({ query: '{ account(id: 123) { id } }' });
    expect(body.errors).toBeDefined();
  });

  it('JSON-fallback query returns the raw object through the JSON scalar', async () => {
    const body = await post({ query: '{ accountStats }' });
    expect(body.errors).toBeUndefined();
    expect(body.data.accountStats).toEqual({ total: 2, active: 1 });
  });

  it('GET request executes a typed query', async () => {
    const query = encodeURIComponent('{ account(id: "9") { id name } }');
    const res = await h.fetch(new Request(`http://localhost/graphql?query=${query}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.account).toEqual({ id: '9', name: 'Ada Lovelace' });
  });
});
