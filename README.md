<div align="center">

<img src="veloce-ts-v2.png" alt="Veloce-TS Logo" width="300" />

---

### Modern, Fast Web Framework for TypeScript

*Inspired by FastAPI, Built on Hono.js*

[![npm version](https://img.shields.io/npm/v/veloce-ts.svg)](https://www.npmjs.com/package/veloce-ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black.svg)](https://bun.sh/)
[![Documentation](https://img.shields.io/badge/docs-online-brightgreen.svg)](https://docs.veloce-ts.com)

[Documentation](https://docs.veloce-ts.com) • [Examples](https://docs.veloce-ts.com/en/guides/getting-started) • [API Reference](https://docs.veloce-ts.com/en/reference/api-reference)

---

</div>

> **Veloce** (Italian for "fast") brings the elegance of Python's FastAPI to TypeScript with decorators, automatic validation, and blazing-fast performance.

## ✨ Features

<table>
<tr>
<td width="50%">

### 🚀 **Performance First**
Built on Hono.js — measured **~1.8× faster than Express 4** ([benchmarks](BENCHMARKS.md))
- Optimized routing
- Minimal overhead
- Edge-ready

### 🎯 **Type Safety**
Full TypeScript with inference
- Zod schema validation
- Automatic type generation
- Zero runtime surprises

### ✨ **Developer Experience**
Clean, intuitive API
- Decorator-based routing
- Auto-generated docs
- Hot reload support

</td>
<td width="50%">

### 🔌 **Dependency Injection**
Built-in DI container
- Singleton, Request, Transient scopes
- Constructor injection
- Easy testing

### 🌐 **Multi-Runtime**
Write once, run anywhere
- Bun (recommended)
- Node.js 20+
- Deno
- Cloudflare Workers

### 🔧 **Extensible**
Plugin ecosystem
- OpenAPI/Swagger
- GraphQL
- WebSocket
- Custom plugins

### ⚡ **Performance** (v0.3.0)
Response caching
- In-memory & Redis stores
- Pattern invalidation
- TTL configuration
- Auto cache headers

### 🔍 **Observability** (v0.3.0)
Request tracing
- Auto UUID tracking
- Request cancellation
- Timeout management
- Structured logging

### 🛡️ **Battle-tested** (v0.4.18)
Security & correctness audit
- 375 tests, 0 failures
- Auth routes secured (RBAC/Permissions)
- JWT blacklist O(1) Map lookup
- In-process benchmarks included

</td>
</tr>
</table>

## 📦 Installation

```bash
# Using Bun (recommended)
bun add veloce-ts zod

# Using npm
npm install veloce-ts zod

# Using pnpm
pnpm add veloce-ts zod
```

**CLI Tool (optional)**
```bash
npm install -g veloce-ts
```

## 🚀 Quick Start

Create your first API in under 2 minutes:

```typescript
import { Veloce, Controller, Get, Post, Body, Param, Query } from 'veloce-ts';
import { z } from 'zod';

// Define validation schemas
const CreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(18).optional(),
});

const QuerySchema = z.object({
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('10'),
});

@Controller('/users')
class UserController {
  @Get('/')
  async listUsers(@Query(QuerySchema) query: z.infer<typeof QuerySchema>) {
    return {
      users: [{ id: 1, name: 'John', email: 'john@example.com' }],
      page: query.page,
      limit: query.limit,
    };
  }

  @Get('/:id')
  async getUser(@Param('id') id: string) {
    return { id, name: 'John', email: 'john@example.com' };
  }

  @Post('/')
  async createUser(@Body(CreateUserSchema) user: z.infer<typeof CreateUserSchema>) {
    return { id: 2, ...user, createdAt: new Date() };
  }
}

const app = new Veloce({
  title: 'My API',
  version: '1.0.0',
  description: 'A sample API built with Veloce',
});

app.include(UserController);

app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
  console.log('📚 Docs available at http://localhost:3000/docs');
});
```

**That's it!** 🎉 Your API is now running with:
- ✅ Automatic validation
- ✅ Type safety
- ✅ OpenAPI docs at `/docs`
- ✅ Swagger UI ready

---

## 💡 More Examples

<details>
<summary><b>Functional API (No Decorators)</b></summary>

```typescript
import { Veloce } from 'veloce-ts';
import { z } from 'zod';

const app = new Veloce();

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

app.get('/users', {
  handler: async (c) => {
    return [{ id: 1, name: 'John' }];
  },
});

app.post('/users', {
  schema: { body: UserSchema },
  // Validated arguments follow the context, in the order body, query, params, headers
  handler: async (c, user) => {
    return { id: 2, ...user };
  },
});

app.listen(3000);
```

</details>

<details>
<summary><b>With Dependency Injection</b></summary>

```typescript
import { Veloce, Controller, Get, Depends } from 'veloce-ts';

class DatabaseService {
  async getUsers() {
    return [{ id: 1, name: 'John' }];
  }
}

@Controller('/users')
class UserController {
  @Get('/')
  async getUsers(@Depends(DatabaseService) db: DatabaseService) {
    return await db.getUsers();
  }
}

const app = new Veloce();
app.getContainer().register(DatabaseService, { scope: 'singleton' });
app.include(UserController);
app.listen(3000);
```

A provider can also be built **from the request** (v3.7.0): a `request`-scoped
factory receives the context and runs once per request, however many places
inject it.

```typescript
class Locale {
  constructor(public readonly code: string) {}
}

app.getContainer().register(Locale, {
  scope: 'request',
  factory: ({ c }) => new Locale(c!.req.header('Accept-Language')?.slice(0, 2) ?? 'en'),
});

@Get('/greeting')
greet(@Depends(Locale) locale: Locale) {
  return { hello: locale.code };
}
```

For a plain value derived from the request, a custom parameter decorator is
lighter still:

```typescript
import { createParamDecorator } from 'veloce-ts';

export const UserAgent = createParamDecorator<string | undefined>((c) => c.req.header('User-Agent'));

@Get('/whoami')
whoami(@UserAgent() agent: string) {
  return { agent };
}
```

> Inject request-scoped providers as **handler parameters**. A singleton that
> takes one in its constructor keeps the first request's instance forever; the
> container logs a "Captive dependency" warning when it sees that.

</details>

<details>
<summary><b>WebSocket Support</b></summary>

```typescript
import { WebSocket, OnConnect, OnMessage, OnDisconnect, WebSocketConnection } from 'veloce-ts';
import { z } from 'zod';

const MessageSchema = z.object({
  type: z.string(),
  content: z.string(),
});

@WebSocket('/chat')
class ChatHandler {
  @OnConnect()
  handleConnect(client: WebSocketConnection) {
    client.join('lobby');
    client.send({ type: 'welcome', message: 'Hello!' });
  }

  @OnMessage(MessageSchema)
  handleMessage(client: WebSocketConnection, message: z.infer<typeof MessageSchema>) {
    client.broadcast(message, 'lobby');
  }

  @OnDisconnect()
  handleDisconnect(client: WebSocketConnection) {
    console.log('Client disconnected');
  }
}
```

**Authenticated gateways (v3.7.0).** `{ auth: true }` refuses the upgrade with
401 *before* the handshake unless the client is authenticated, and hands the
verified user to the gateway. An object returned by `authorizeUpgrade` becomes
`connection.data`.

```typescript
import { WebSocket, OnConnect, WebSocketPlugin, type WebSocketConnection, type WebSocketGateway } from 'veloce-ts';
import type { Context } from 'hono';

@WebSocket('/ws/chat', { auth: true, rateLimit: { max: 20, windowMs: 10_000 } })
class ChatGateway implements WebSocketGateway<{ room: string }> {
  // Optional: your own checks, after the framework authenticated the caller
  authorizeUpgrade(c: Context) {
    const room = c.req.query('room');
    return room ? { room } : false;          // false → 401
  }

  @OnConnect()
  onConnect(conn: WebSocketConnection<{ room: string }>) {
    conn.join(conn.data.room);
    conn.send({ type: 'welcome', user: conn.user?.sub });
  }
}

// `auth: {}` enables one-time connection tickets (see below)
app.usePlugin(new WebSocketPlugin({ auth: {} }));
```

Browsers cannot set an `Authorization` header on a WebSocket. Rather than put
the access token in the URL — where it lands in proxy and server logs — trade
it for a **single-use ticket** first:

```typescript
// Browser
const { ticket } = await fetch('/ws/ticket', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
}).then((r) => r.json());

const ws = new WebSocket(`wss://api.example.com/ws/chat?room=general&ticket=${ticket}`);
```

| `@WebSocket` option | Effect |
|---|---|
| `auth: true` | 401 unless authenticated; user available as `connection.user` |
| `roles: ['admin']` | 403 without one of the roles (uses the RBAC plugin when installed) |
| `closeOnTokenExpiry` | Close with code `4401` when the token expires (default `true`) |
| `rateLimit: { max, windowMs }` | Drop inbound messages over the limit, per connection |

`plugin.getManager().disconnectUser(userId)` closes every connection of a user —
call it on logout or when access is revoked. Credential sources are configurable
(`auth: { sources: ['header', 'ticket', 'query'] }`; `query`, the token in the URL,
is off by default), and `auth.ticket.store` takes a shared store when you run
more than one instance.

**Testing a gateway** needs no server — `TestClient.ws()` goes through the real
route (middleware, authentication, `authorizeUpgrade`) and replaces only the transport:

```typescript
import { TestClient } from 'veloce-ts/testing';

const client = new TestClient(app);

const ws = await client.withToken(token).ws('/ws/chat', { query: { room: 'general' } });
expect(await ws.nextMessage()).toMatchObject({ type: 'welcome' });
await ws.close();

await expect(client.ws('/ws/chat')).rejects.toMatchObject({ status: 401 });
```

</details>

<details>
<summary><b>GraphQL API</b></summary>

```typescript
import { Resolver, Query, Mutation, Arg } from 'veloce-ts';
import { z } from 'zod';

const CreateUserInput = z.object({
  name: z.string(),
  email: z.string().email(),
});

@Resolver()
class UserResolver {
  @Query()
  async users() {
    return [{ id: 1, name: 'John' }];
  }

  @Mutation()
  async createUser(@Arg('input', CreateUserInput) input: z.infer<typeof CreateUserInput>) {
    return { id: 2, ...input };
  }
}
```

</details>

<details>
<summary><b>🔐 Authentication & access control (v3.6.0)</b></summary>

```typescript
import {
  Veloce, Controller, Get, Post, Delete, Param,
  AuthPlugin, RBACPlugin, Auth, Roles, Public, CurrentUser,
} from 'veloce-ts';
import { z } from 'zod';

const app = new Veloce();

app.usePlugin(new AuthPlugin({
  jwt: { secret: process.env.JWT_SECRET! },
  userProvider,
  // Deny by default: a route with no access decorator needs a valid token.
  // Without this, forgetting a decorator silently publishes the route.
  requireAuthByDefault: true,
}));

app.usePlugin(new RBACPlugin({
  useDefaults: false,
  enableManagementRoutes: false,
  roles: [
    { name: 'admin',  permissions: ['*'], level: 100, inherits: ['member'] },
    { name: 'member', permissions: ['orders:read'], level: 10 },
  ],
}));

@Controller('/orders')
@Roles(['member'])                 // default for every route of the controller
class OrdersController {
  @Get('/')                        // members and admins (admin inherits member)
  list() {}

  @Delete('/:id')
  @Roles(['admin'])                // a method-level decorator replaces the class one
  remove(@Param('id', z.string().uuid()) id: string) {}   // malformed id → 422, never reaches the DB

  @Get('/status')
  @Public()                        // the explicit exception
  status() { return { ok: true }; }
}
```

> `@Auth({ roles: ['a', 'b'] })` requires **all** the listed roles;
> `@Roles(['a', 'b'])` requires **any** of them, and is the one that understands
> role inheritance and `resolveRoles`. Prefer `@Roles` for role checks.

| You write | You get |
|---|---|
| `@Auth()` / `@Roles([...])` on a **class** | The rule applies to every route in it |
| `@Public()` on a method or class | Open on purpose; overrides the class rule and `requireAuthByDefault` |
| `requireAuthByDefault: true` | Undecorated routes need a token. Login, refresh, register, health and docs stay public |
| `@Param('id', schema)` / `@Param(schema)` | Path parameters validated (and coerced) with Zod |
| `public: true` in `app.get(path, { … })` | `@Public()` for the functional API |

`requireAuthByDefault` covers every route in the registry, including those other
plugins add. WebSocket gateways declare their own access (`@WebSocket(path, { auth: true })`).

</details>

<details>
<summary><b>🏢 Multi-tenant applications (v3.6.0 – v3.7.0)</b></summary>

One user, a different role in each organization, and the organization chosen
per request. A role stored in the token cannot express that — `@Roles(['admin'])`
would check a role that may belong to a *different* organization. Resolve it per
request instead:

```typescript
import {
  Veloce, Controller, Get, Post, AuthPlugin, RBACPlugin, Roles,
  ForbiddenException, createParamDecorator, registerDrizzle, InjectDB,
} from 'veloce-ts';
import { sql } from 'drizzle-orm';

interface Tenant { id: string; memberId: string; role: string }

declare module 'hono' {
  interface ContextVariableMap { tenant: Tenant }
}

const app = new Veloce();
app.usePlugin(new AuthPlugin({ jwt: { secret: process.env.JWT_SECRET! }, userProvider, requireAuthByDefault: true }));

// 1. Resolve the tenant once per request, after authentication. `afterPlugins`
//    middleware runs in registration order, so this comes before everything
//    below that needs the tenant.
app.use(async (c, next) => {
  const user = c.get('auth.user');
  const orgId = c.req.header('X-Org-ID');
  if (user && orgId) {
    const member = await findMembership(user.sub, orgId);
    if (!member) throw new ForbiddenException('Not a member of this organization');
    c.set('tenant', { id: member.orgId, memberId: member.id, role: member.role });
  }
  await next();
}, { phase: 'afterPlugins' });

app.usePlugin(new RBACPlugin({
  useDefaults: false,
  enableManagementRoutes: false,
  roles: [
    { name: 'owner',  permissions: ['*'], level: 100, inherits: ['member'] },
    { name: 'member', permissions: [], level: 10 },
  ],
  // 2. Roles come from the membership in the organization being accessed,
  //    not from the token.
  resolveRoles: (c) => {
    const tenant = c.get('tenant');
    if (!tenant) throw new ForbiddenException('X-Org-ID header required');
    return [tenant.role];
  },
}));

// 3. The tenant reaches handlers as a parameter — no helper to remember to call
export const CurrentTenant = createParamDecorator<Tenant>((c) => c.get('tenant'));

// 4. Rate-limit per user (or per address when anonymous), not per client-supplied header
app.useRateLimit({ windowMs: 60_000, max: 300, keyBy: 'user-or-ip', trustedProxyHops: 1 });

// 5. Every transaction tells PostgreSQL which tenant it serves, so row-level
//    security policies can enforce isolation even if a query forgets its filter.
//    Registered after the tenant middleware, so the tenant is known at BEGIN.
registerDrizzle(app, db, {
  transactionPerRequest: (c) => c.req.method !== 'GET',
  onBegin: async (tx, c) => {
    const tenant = c?.get('tenant');
    if (tenant) await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
  },
});

@Controller('/projects')
@Roles(['member'])
class ProjectsController {
  constructor(@InjectDB() private db: typeof db) {}

  @Get('/')
  list(@CurrentTenant() tenant: Tenant) {
    return this.db.select().from(projects).where(eq(projects.orgId, tenant.id));
  }

  @Post('/')
  @Roles(['owner'])                 // owner *of this organization*
  create(@CurrentTenant() tenant: Tenant) { /* … */ }
}
```

Application middleware that needs the authenticated user goes in the
`afterPlugins` phase — see [Middleware](#middleware).

</details>

<details>
<summary><b>🗄️ Transactions (v3.7.0)</b></summary>

`registerDrizzle()` injects a transaction-aware handle. Inside a transaction,
every query made through it — by your method, or by any service it awaits — is
part of that transaction. Nothing is passed around, and a class that stored
`this.db` in its constructor needs no change.

```typescript
import { registerDrizzle, InjectDB, Transactional, runInTransaction, Inject } from 'veloce-ts';

registerDrizzle(app, db);

class Inventory {
  constructor(@InjectDB() private db: typeof db) {}

  async reserve(items: Item[]) {
    for (const item of items) {
      await this.db.update(stock).set({ reserved: sql`${stock.reserved} + ${item.qty}` }).where(eq(stock.sku, item.sku));
    }
  }
}

class Orders {
  constructor(@InjectDB() private db: typeof db, @Inject(Inventory) private inventory: Inventory) {}

  @Transactional()                       // commit on return, roll back on throw
  async place(order: NewOrder) {
    await this.db.insert(orders).values(order);
    await this.inventory.reserve(order.items);   // same transaction, no `tx` argument
    if (order.total > order.creditLimit) throw new BadRequestException('Credit limit exceeded');
  }

  // Or a block:
  async cancel(id: string) {
    await runInTransaction(this.db, async () => {
      await this.db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, id));
      await this.inventory.release(id);
    });
  }
}
```

| | |
|---|---|
| Nested call | Joins the active transaction. `@Transactional({ nested: true })` / `{ nested: true }` opens a savepoint instead |
| `this.db.transaction(cb)` | Ambient too: queries on `this.db` inside `cb` are part of it |
| `transactionPerRequest` | `registerDrizzle(app, db, { transactionPerRequest: true \| (c) => boolean })` wraps a request in one transaction; rolled back when the request fails. Off by default — it holds a pool connection for the whole request |
| `onBegin(tx, c)` | Runs at the start of every outermost transaction, inside it: set per-transaction session state (e.g. the tenant for row-level security) |

Two things to know:

- Only **awaited** work is covered. A promise you start and do not await may run
  after the commit; it then uses the plain database, never the finished transaction.
- The driver must run the transaction callback asynchronously. This is verified
  against Drizzle's PostgreSQL dialect; other async drivers follow the same
  contract but are not covered by tests. Synchronous SQLite drivers
  (`bun:sqlite`, `better-sqlite3`) commit before an `await` inside the callback
  resolves, so do not use ambient transactions with them.

</details>

<details>
<summary><b>⚡ Response Caching (NEW in v0.3.0)</b></summary>

```typescript
import { Controller, Get, Post, Cache, CacheInvalidate, Param, Body } from 'veloce-ts';

@Controller('/products')
class ProductController {
  // Cache responses for 5 minutes
  @Get('/')
  @Cache({ ttl: '5m', key: 'products:list' })
  async listProducts() {
    return await db.products.findMany();
  }

  // Cache with dynamic key based on ID
  @Get('/:id')
  @Cache({ ttl: '10m', key: 'product:{id}' })
  async getProduct(@Param('id') id: string) {
    return await db.products.findOne(id);
  }

  // Invalidate cache patterns on mutation
  @Post('/')
  @CacheInvalidate(['products:*'])
  async createProduct(@Body(ProductSchema) data: any) {
    return await db.products.create(data);
  }

  // ⚠️ Caching a per-user response? Vary the key by the caller, or every user
  // gets served whichever response was cached first.
  @Get('/recommended')
  @Cache({ ttl: '1m', varyByHeaders: ['authorization'] })
  async recommended(@CurrentUser() user: TokenPayload) {
    return await db.products.recommendFor(user.sub);
  }
}

// Or use Redis for distributed caching
import { RedisCacheStore } from 'veloce-ts/cache';

const redisCache = new RedisCacheStore({
  host: 'localhost',
  port: 6379,
});

app.use(createCacheMiddleware({ store: redisCache }));
```

</details>

<details>
<summary><b>🔍 Request Context & Tracing (NEW in v0.3.0)</b></summary>

```typescript
import { Controller, Get, RequestId, AbortSignal } from 'veloce-ts';
import { createRequestContextMiddleware } from 'veloce-ts';

// Enable request context middleware
app.use(createRequestContextMiddleware({
  timeout: 30000,  // 30 second timeout
  logging: true    // Auto-log all requests
}));

@Controller('/data')
class DataController {
  // Get unique request ID for tracing
  @Get('/process')
  async processData(@RequestId() requestId: string) {
    logger.info({ requestId }, 'Processing started');
    
    // Request ID is automatically included in all logs
    await performHeavyTask();
    
    logger.info({ requestId }, 'Processing completed');
    return { requestId, status: 'done' };
  }

  // Use AbortSignal for cancellation
  @Get('/long-running')
  async longRunning(@AbortSignal() signal: AbortSignal) {
    // Check if request was cancelled
    if (signal.aborted) {
      throw new Error('Request cancelled');
    }
    
    // Listen for cancellation
    signal.addEventListener('abort', () => {
      console.log('Request cancelled by client');
    });
    
    return await performLongTask();
  }
}

// Request ID is automatically added to response headers as X-Request-ID
// Example log output:
// [2025-10-29 10:23:45] [req-id: abc-123-def-456] INFO: Request started GET /data/process
// [2025-10-29 10:23:45] [req-id: abc-123-def-456] INFO: Processing started
// [2025-10-29 10:23:46] [req-id: abc-123-def-456] INFO: Processing completed
```

</details>

---

## 🛠️ CLI Commands

```bash
# Create a new project
veloce-ts new my-api --template rest

# Start development server
veloce-ts dev

# Build for production
veloce-ts build

# Generate OpenAPI spec
veloce-ts generate openapi

# Generate TypeScript client
veloce-ts generate client
```

**Available Templates:**
- `rest` - REST API with examples
- `graphql` - GraphQL API
- `websocket` - WebSocket server
- `fullstack` - All features combined

## 📚 Core Concepts

### Validation with Zod

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(18).optional(),
});

type User = z.infer<typeof UserSchema>; // Automatic type inference
```

Schemas attach to the body, the query string and — since v3.6.0 — path parameters:

```typescript
@Get('/:id')
getUser(@Param('id', z.string().uuid()) id: string) {}          // one parameter

@Get('/:year/:month')
archive(@Param(z.object({ year: z.coerce.number(), month: z.coerce.number().min(1).max(12) })) p: { year: number; month: number }) {}
```

A value that fails validation is a `422` before the handler runs.

### Middleware

```typescript
// Global middleware
app.use(async (c, next) => {
  console.log(`${c.req.method} ${c.req.url}`);
  await next();
});

// Scoped to a path (v3.7.0)
app.use('/admin/*', auditMiddleware);

// After the middleware plugins install (v3.7.0): runs once the request is
// authenticated, so it can read `auth.user`. A plain app.use() runs before
// authentication and never sees the user.
app.use(async (c, next) => {
  const user = c.get('auth.user');
  // …
  await next();
}, { phase: 'afterPlugins' });

// Built-in middleware
app.useCors({ origin: '*' });
app.useRateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.useCompression();

// Request context with tracing (v0.3.0)
import { createRequestContextMiddleware } from 'veloce-ts';
app.use(createRequestContextMiddleware({
  timeout: 30000,
  logging: true
}));

// Response caching (v0.3.0)
import { createCacheMiddleware, InMemoryCacheStore } from 'veloce-ts';
app.use(createCacheMiddleware({
  store: new InMemoryCacheStore({ maxSize: 1000 })
}));
```

**Order of execution:** body-size limit → CORS → `app.use()` (early) → plugin
middleware (auth, RBAC, session) → `app.use(…, { phase: 'afterPlugins' })` →
route guards (`@Auth`, `@Roles`) → controller and route middleware → handler.

**Rate limiting** (v3.7.0) can key on who is calling rather than only on where from:

```typescript
app.useRateLimit({
  windowMs: 60_000,
  max: 300,
  keyBy: 'user-or-ip',        // 'ip' (default) | 'user' | 'user-or-ip'
  trustedProxyHops: 1,        // proxies YOU run in front of the app; 0 = none
  skip: (c) => c.req.path.startsWith('/health'),
});
```

`trustedProxyHops` reads the client address from the `X-Forwarded-For` entry
written by your own proxy, counted from the right — the leftmost entry is
whatever the client typed. The same logic is exported as
`clientIp(c, { trustedProxyHops })`. The default store is in-memory and
per-process; pass `store: new RedisRateLimitStore(…)` when you run several instances.

**Body size** is limited to 1 MiB application-wide (`new Veloce({ bodyLimit })`).
Override it per route, in either direction (v3.7.0):

```typescript
@Put('/upload')
@BodyLimit(25 * 1024 * 1024)
upload() {}

app.post('/import', { handler, bodyLimit: 5 * 1024 * 1024 });
```

### Error Handling

```typescript
import { HTTPException } from 'veloce-ts';

@Get('/:id')
async getUser(@Param('id') id: string) {
  const user = await findUser(id);
  if (!user) {
    throw new HTTPException(404, 'User not found');
  }
  return user;
}
```

## 🔌 Plugin System

```typescript
import { Veloce, OpenAPIPlugin, GraphQLPlugin } from 'veloce-ts';

const app = new Veloce();

// OpenAPI documentation
app.usePlugin(new OpenAPIPlugin({
  path: '/openapi.json',
  docsPath: '/docs',
}));

// GraphQL support — pass resolver classes via the resolvers option
import { Resolver, GQLQuery, GQLMutation, Arg } from 'veloce-ts/graphql';
import { z } from 'zod';

@Resolver('user')
class UserResolver {
  @GQLQuery('getUser')
  async getUser(@Arg('id', z.string()) id: string) {
    return { id, name: 'Alice' };
  }

  @GQLMutation('createUser')
  async createUser(@Arg('name', z.string()) name: string) {
    return { id: '1', name };
  }
}

app.usePlugin(new GraphQLPlugin({
  path: '/graphql',
  playground: true,
  resolvers: [UserResolver],   // pass all @Resolver classes here
}));

// Alternatively, register via app.include() before usePlugin():
// app.include(UserResolver);
// app.usePlugin(new GraphQLPlugin({ playground: true }));
```

## 🌐 Multi-Runtime Support

| Runtime | Status | Notes |
|---------|--------|-------|
| **Bun** | ✅ Recommended | Best performance |
| **Node.js** | ✅ Supported | v20+ required; `listen()` needs `@hono/node-server` |
| **Deno** | ✅ Supported | Use `npm:veloce-ts` |
| **Cloudflare Workers** | ✅ Supported | Deploy via `getFetchHandler()`, not `listen()`. Requires the `nodejs_compat` flag |

> **WebSockets:** HTTP → WS upgrade works on **Bun**, **Deno** and — since **v3.2.0** — **Node.js**, where it goes through the optional `@hono/node-ws` peer dependency and the app must be served with `app.listen()`. The decorators and `WebSocketConnection` API are identical on all three.

```typescript
// Core HTTP routing and WebSocket upgrades work on all supported runtimes.
import { Veloce } from 'veloce-ts';
const app = new Veloce();
app.listen(3000);
```

**Cloudflare Workers** don't accept an incoming connection to bind a port to — Workers invoke a `fetch(request, env, ctx)` export per request instead, so `listen()` throws there. Use `getFetchHandler()`:

```typescript
// worker.ts
import { Veloce } from 'veloce-ts';

const app = new Veloce({ title: 'My API' });
app.get('/hello', { handler: () => ({ message: 'hi' }) });

export default {
  fetch: await app.getFetchHandler(),
};
```

Deploy with `wrangler deploy`.

## ⚠️ Current limitations

These are **known gaps today** so you can choose Veloce-TS with clear expectations:

| Area | Limitation |
|------|------------|
| **GraphQL schema stitching** | Queries, mutations and — as of **v3.4.0** — subscriptions all execute. Composing schemas across services is not hardened; do it at the gateway rather than relying on the plugin. |
| **ORM integrations** | First-class **Drizzle** helpers exist for the DI container (`registerDrizzle`, `@InjectDB`) and, since **v3.7.0**, ambient transactions (`@Transactional`, `runInTransaction`, per-request transactions). **Prisma** and **TypeORM** are **not yet** at the same level of documented, built-in integration—use them directly in your services today. |
| **Ambient transactions** | Need a driver whose `transaction()` callback is asynchronous. Verified against Drizzle's PostgreSQL dialect; other async drivers are untested. **Synchronous SQLite drivers** (`bun:sqlite`, `better-sqlite3`) are not supported: they commit before an `await` inside the callback resolves. |
| **WebSocket credentials** | Authenticated gateways accept the `Authorization` header, a one-time ticket, or (opt-in) the token in the query string. Carrying the token in the **`Sec-WebSocket-Protocol`** header is not supported. `requireAuthByDefault` does not cover gateways — declare `@WebSocket(path, { auth: true })`. |
| **Defaults kept for compatibility** | `RBACPlugin` still registers its `/rbac/*` management routes and a set of default roles unless you pass `enableManagementRoutes: false` and `useDefaults: false`; routes are public unless decorated, unless you turn on `requireAuthByDefault`; unexpected errors include their message and stack unless `NODE_ENV` is exactly `production`. These flip in the next major version. |
| **Test coverage** | Line coverage over `src/` is **~57%**, gated in CI at 55%. The thinnest areas are the cache and request-context middleware, the logging middleware and health plugin, and the OAuth/permission helpers. Treat those with more caution than the core routing and validation surface. |
| **API stability** | Stable public API since v1.0.0 (semver). Check the [CHANGELOG](CHANGELOG.md) for what changed between releases. |

## 🔭 Planned updates (roadmap)

Directional priorities—not a release calendar. Items may ship in a different order.

1. **ORM choice** — Make **Drizzle, Prisma, and TypeORM** practical first-class options: clear patterns, docs, and (where it helps) small helpers so teams can **pick one ORM** without fighting the framework.
2. **GraphQL schema stitching** — Subscriptions execute as of v3.4.0; composing schemas across services is the part still to harden.
3. **Raise the coverage floor** — The CI gate sits at 55% to block regressions; the goal is to lift it as the thin areas above get tested.

**Completed in v3.6.0–v3.7.0:** request-scoped roles for multi-tenant apps (`resolveRoles`), class-level `@Auth`/`@Roles`, `@Public`, deny-by-default (`requireAuthByDefault`), `@Param` with a schema, middleware phases and paths, per-route `@BodyLimit`, `createParamDecorator`, context-aware provider factories, a rate limiter keyed by user or by real client address, authenticated WebSocket gateways with one-time tickets and an in-process `TestClient.ws()`, and ambient transactions for Drizzle. Driven by an audit of a real multi-tenant application; the suite grew from 647 to 880+ tests.

**Completed in v3.2.0–v3.5.0:** WebSocket upgrades on **Node** (via the optional `@hono/node-ws` peer), **GraphQL subscriptions** over `graphql-transport-ws` on Bun/Deno/Node with a built-in `PubSub`, the `@On('event')` decorator, CLI parity with Node (`--runtime auto|bun|node`, `--install`, `--git`, `generate gateway|listener`), and a published package cut from 1.5 MB to 0.39 MB.

**Completed in v1.2.0:** CLI code generation (`veloce generate controller|service|module|resolver|dto|middleware|plugin`), graceful shutdown, exception filters, interceptors, streaming/SSE responses, event bus, OpenAPI 3.1.

**Completed in v0.4.18:** Security audit of auth routes, JWT blacklist correctness, MetadataCompiler cache isolation fix, ORM lazy-loading for optional peer deps, 375-test suite, internal micro-benchmarks.

For the latest shipped changes, see [CHANGELOG](CHANGELOG.md). Discussion and proposals: [GitHub Discussions](https://github.com/ExcessHawk/veloce-ts/discussions).

## 📖 Documentation

| Resource | Description |
|----------|-------------|
| [📚 Full Documentation](https://docs.veloce-ts.com) | Complete guides and API reference |
| [⚠️ Limitations & roadmap](https://docs.veloce-ts.com/en/guides/limitations-and-roadmap/) | Known gaps and planned direction |
| [💡 Examples & Guides](https://docs.veloce-ts.com/en/guides/getting-started) | Tutorials and code examples |
| [🔧 API Reference](https://docs.veloce-ts.com/en/reference/api-reference) | Detailed API documentation |

## ⚙️ Requirements

- **Runtime**: Bun >= 1.0.0 (recommended) or Node.js >= 20.0.0
- **TypeScript**: >= 5.0.0
- **Zod**: >= 3.22.0

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

## 👥 Core Team

### ExcessHawk - Lead Developer & Framework Architect
<img src="https://i.imgur.com/oogie-boogie-profile.png" alt="ExcessHawk" width="60" height="60" style="border-radius: 50%;">

**[@ExcessHawk](https://github.com/ExcessHawk)** - *"Building fast, type-safe web frameworks that developers love to use."*

- 🏗️ Core framework architecture and design
- ⚡ Performance optimizations and benchmarking  
- 🛠️ Developer experience and tooling
- 🔌 Plugin system and extensibility

### Alfredo Mejia - Project Founder
**[@ExcessHawk](https://github.com/ExcessHawk)** - Project founder and maintainer

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. See our [Contributing Guide](CONTRIBUTING.md) for more details.

## 📄 License

MIT © 2025 Veloce Contributors

## 🙏 Acknowledgments

Built with ❤️ using:
- [FastAPI](https://fastapi.tiangolo.com/) - Inspiration
- [Hono.js](https://hono.dev/) - Core framework
- [Zod](https://zod.dev/) - Validation

---

<div align="center">

**[⭐ Star us on GitHub](https://github.com/ExcessHawk/veloce-ts)** • **[📖 Read the Docs](https://docs.veloce-ts.com)** • **[💬 Join Discussions](https://github.com/ExcessHawk/veloce-ts/discussions)**

Made with ⚡ by the Veloce team

</div>

