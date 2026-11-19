# Migration Guide

## 3.x → 4.0.0

4.0.0 flips defaults; it does not redesign anything. The shortest path is to
upgrade to **3.9.0** first, start the application, and read the console: every
`[veloce-ts deprecation …]` notice names one item below that applies to you.
No notices means no changes.

Each item lists the option that keeps the 3.x behavior, so you can upgrade
first and adopt the new defaults one at a time.

### 1. Undecorated routes require a token

Applies when `AuthPlugin` is installed. A route with no `@Auth`, `@Roles`,
`@Permissions`, `@MinimumRole` or `@Public` — on the method or the class —
was public and now answers 401.

```typescript
@Get('/status')
@Public()                      // open on purpose
status() { return { ok: true }; }

app.get('/webhooks/stripe', { handler, public: true });   // functional API
```

Routes registered by the framework (login, refresh, register, logout, OAuth,
session, health, documentation) are already marked. Routes that authenticate
by their own means — a webhook signature, an API key checked in the handler —
need `public: true`, or the JWT guard rejects them before your check runs.

To keep the old behavior: `new AuthPlugin({ …, requireAuthByDefault: false })`.

WebSocket gateways are not covered; they declare `@WebSocket(path, { auth: true })`.

### 2. GraphQL is not behind that guard

The GraphQL endpoint stays reachable without a token (`public: true` by
default), because a single route serves every operation. If all your operations
require an authenticated caller: `new GraphQLPlugin({ public: false })`.

### 3. `RBACPlugin`: no management routes, no built-in roles next to yours

```typescript
// 3.x behavior
new RBACPlugin({ roles, enableManagementRoutes: true, useDefaults: true });
```

- The seven `/rbac/*` routes are registered only with `enableManagementRoutes: true`.
- When you pass `roles`, the built-in `guest`, `user`, `moderator`, `admin` and
  `super-admin` are not created. If a decorator names one of them — say
  `@Roles(['admin'])` — define that role yourself or pass `useDefaults: true`.
  With no `roles` at all, the built-in set is still created.

### 4. Error detail needs `NODE_ENV=development` or `test`

Unexpected errors used to include their message and stack unless `NODE_ENV` was
exactly `production`. Now they include them only in `development` and `test`.
If you develop with `NODE_ENV` unset and miss the detail in responses, set it
to `development` or pass `forceDevelopment: true` to the error handler. The
server log is unaffected.

### 5. Captive dependencies throw

A singleton whose constructor injects a request-scoped provider logged a
warning since 3.7.0. It now throws when resolved:

```typescript
// Before: one request's instance, kept forever
@Controller('/orders')
class OrdersController {
  constructor(private tenant: TenantContext) {}        // request-scoped
}

// After: per request
@Get('/')
list(@Inject(TenantContext) tenant: TenantContext) { … }
```

Or register the consumer with the `request` scope.

### 6. Rate limiter: `trustProxy` → `trustedProxyHops`

```typescript
app.useRateLimit({ max: 100, trustProxy: true });       // throws TypeError
app.useRateLimit({ max: 100, trustedProxyHops: 1 });    // one proxy you run
```

`trustedProxyHops` counts from the right of `X-Forwarded-For`, where your own
proxies write, instead of trusting the leftmost entry, which the client writes.

### 7. `@Throttle` and `@ApiVersion` are gone

Neither did anything. Replace `@Throttle(...)` with
`@RateLimit({ max, windowMs })` — note the route was **not** rate limited
before — and `@ApiVersion('2')` with a versioned prefix, `@Controller('/v2/orders')`.

---

## 3.5.x → 3.6.0 and 3.7.0

Both releases are additive: nothing has to change for an application to keep
working. Seven fixes and changes can alter observable behavior, though, and
three new options are worth turning on.

---

### What can behave differently

#### 1. Route middleware runs once (3.6.0)

`@UseMiddleware`, `@RateLimit` and `@Timeout` used to be registered once per
decorator stacked on the route — twice with `@Post` above `@UseMiddleware`, more
with `@Roles`, `@HttpCode` and friends. A per-route rate limiter therefore
allowed **half** the configured requests.

After upgrading, limits are the ones you wrote. If you had doubled `max` to
compensate, halve it back.

#### 2. The registered DI scope wins (3.6.0)

```typescript
container.register(Mailer, { scope: 'singleton', factory: () => new Mailer() });

// Before: @Depends defaults to 'request', which overrode the registration —
//         a new Mailer per request.
// After:  one Mailer, as registered.
handler(@Depends(Mailer) mailer: Mailer) {}
```

The scope passed to `register()` is now the provider's lifetime. The injection
site's scope only applies to providers registered without one, or not registered
at all. If you registered a provider as `'transient'` and injected it with
`@Inject` expecting one shared instance, register it as `'singleton'`.

#### 3. Hono's `HTTPException` keeps its status (3.6.0)

An `HTTPException` imported from `hono/http-exception`, or thrown by Hono
middleware, used to become a 500. It now returns its own status. Code that
treated those 500s as failures to retry will see 4xx instead.

#### 4. Graceful shutdown exits 1 when it times out (3.6.0)

It used to exit 0 even when the drain did not finish. Supervisors that restart
on non-zero exit will now notice a truncated shutdown.

#### 5. WebSocket upgrades pass through global middleware (3.7.0)

Gateway routes are registered after global middleware instead of before it, so
the auth middleware — and your own `afterPlugins` middleware — run for upgrade
requests. Two consequences:

- `c.get('auth.user')` is available in `authorizeUpgrade(c)` when the client
  sent an `Authorization` header.
- A global middleware that rejects requests without credentials now rejects
  such upgrades too. Browser clients cannot send that header: exempt the
  gateway path in your middleware, or switch the gateway to
  `@WebSocket(path, { auth: true })` with [connection tickets](README.md).

On **Node**, an unauthorized upgrade now gets an HTTP 401 before the handshake,
as on Bun and Deno. It used to be accepted and then closed with code 1008;
clients that looked for that close code should handle the failed connection instead.

#### 6. `@Transactional()` really is transactional (3.7.0)

With a database registered through `registerDrizzle()`, the decorator used to
open a transaction and leave the method's `this.db` queries **outside** it. They
are now inside. A method that threw after writing used to keep its writes; they
are now rolled back, which is what the decorator always claimed.

`registerDrizzle()` also injects a proxy of your database rather than the object
itself. It behaves identically, but `injected === db` is no longer true — compare
through the proxy, or keep a reference to what `registerDrizzle()` returns.

#### 7. New warnings (3.7.0)

None of these change behavior; they point at configuration that is probably not
doing what you want.

| Warning | Meaning | Fix |
|---|---|---|
| `Captive dependency: singleton "X" injects request-scoped "Y"` | `X` keeps the `Y` of the first request for its whole lifetime. Becomes an error in 4.0 | Inject `Y` as a handler parameter, or give `X` the `'request'` scope |
| `Rate limit: trustProxy: true reads the leftmost X-Forwarded-For entry` | That entry is client-controlled | `trustedProxyHops: <number of proxies you run>` |
| `Rate limit: the client address could not be determined` | All requests share the key `unknown` | Set `trustedProxyHops`, or `keyBy` / `keyGenerator` |
| `Rate limit: using the in-memory store in production` | Counters are per process | `store: new RedisRateLimitStore(…)` |

The default rate-limit key is now prefixed (`ip:<address>`), so counters kept in
a shared store restart once when you deploy the upgrade.

---

### Worth turning on

#### Deny by default

```typescript
new AuthPlugin({ jwt, userProvider, requireAuthByDefault: true });
```

A route with no access decorator then requires a token instead of being public.
Mark the intentionally open ones with `@Public()` (or `public: true` in the
functional API). The framework's login, refresh, register, logout, OAuth, health
and documentation routes are already marked. Expect 401s on any route you had
left undecorated on purpose — that list is exactly what this option exists to surface.

#### Roles per request, in multi-tenant applications

If a user can hold different roles in different organizations and the
organization is chosen per request, a `roles` claim in the token is the wrong
source: `@Roles(['admin'])` checks a role that may belong to another
organization. Configure `RBACPlugin({ resolveRoles })` — see "Multi-tenant
applications" in the [README](README.md).

#### RBAC defaults you may not want

`RBACPlugin` registers seven `/rbac/*` management routes, reachable by any
authenticated user, and creates default roles (`guest`, `user`, `moderator`,
`admin`, `super-admin`) alongside yours. Unless you use them:

```typescript
new RBACPlugin({ roles, useDefaults: false, enableManagementRoutes: false });
```

Both defaults flipped in 4.0.0.

---

## 2.0.x → next (unreleased)

The 2026-09-04 review pass. Most changes are fixes you want silently, but six of them can
change how an existing application behaves.

---

### 1. Route guards actually run now

`@Auth()`, `@Auth({ roles })`, `@Session()`, `@RequireCSRF()` and `@CanAccess`/`@CanRead`/… were
**never enforced** in 2.0.x: the plugins installed their guard by replacing `app.compile`, from
inside a call that `compile()` had already started, so the replacement never executed.

If your app relied on those decorators, it was serving those routes unprotected — and requests
that "worked" before may now correctly receive 401/403. Check that:

- every `@Auth()` route is actually reached with a bearer token;
- roles named in `@Auth({ roles: [...] })` match what your `UserProvider` puts on the user;
- clients of `@RequireCSRF()` routes send `X-CSRF-Token` (or `?_csrf=`).

Nothing to change in your code — this is the behaviour the decorators always advertised.

### 2. `SessionConfig.secret` is required, and cookies are signed

```typescript
// Before — secret was accepted and ignored; the cookie held the raw session id
new SessionPlugin({ session: {} as any });

// After — secret is required and signs the cookie
new SessionPlugin({ session: { secret: process.env.SESSION_SECRET! } });
```

Sessions issued by an older version will not validate against the new signed format: existing
session cookies are rejected and those users simply log in again. Cookies also default to
`secure: true` when `NODE_ENV=production` (set `secure: false` explicitly to opt out).

### 3. `docs` and `plugins` config options now do something

`new VeloceTS({ docs: true })` previously served nothing. It now mounts the OpenAPI plugin at
`/openapi.json` and `/docs`. Since `docs` **defaults to `true`**, an app that never registered
`OpenAPIPlugin` will start exposing its API documentation.

```typescript
new VeloceTS({ docs: false });                                  // keep the old behaviour
new VeloceTS({ docs: { path: '/api-docs', openapi: '/spec' } }); // custom paths
```

Registering `OpenAPIPlugin` yourself still wins — the automatic one is skipped.
`plugins: [...]` in the config now registers those plugins instead of ignoring them.

### 4. Request bodies are limited to 1 MiB by default

Bodies above the limit get 413 before the handler runs. Raise or disable it if you accept
uploads:

```typescript
new VeloceTS({ bodyLimit: 20 * 1024 * 1024 }); // 20 MiB
new VeloceTS({ bodyLimit: 0 });                // no limit
```

### 5. Cached per-user routes need an explicit key

`@Cache()` keys on method + path + params. If the response depends on who is asking, say so —
otherwise one caller's response is served to the next (the framework now logs a warning when it
detects this shape):

```typescript
@Get('/me')
@Cache({ ttl: '1m', varyByHeaders: ['authorization'] })
// or: @Cache({ ttl: '1m', keyGenerator: c => `me:${c.get('auth.user')?.sub}` })
me(@CurrentUser() user: TokenPayload) { … }
```

### 6. `Response` is now `VeloceResponse`

The old export shadowed the global `Response` in any file importing it:

```typescript
// Before — `new Response(...)` in this file silently used the Veloce class
import { Response } from 'veloce-ts';

// After
import { VeloceResponse } from 'veloce-ts';   // or: import { Res } from 'veloce-ts'
```

`Response` still works as a deprecated alias.

### Smaller notes

- `engines.node` is now `>= 20`. Node's `listen()` requires `@hono/node-server` (an optional
  peer dependency) — and it genuinely works now; it previously always threw.
- `Adapter.listen()` may return a `Promise<ServerInstance>`. Custom adapters are unaffected;
  `await` it if you call an adapter directly.
- JWT blacklist entries are keyed by `jti`. A custom `TokenBlacklist` receives token *ids*
  now, and can implement the optional `claim()` for atomic refresh rotation.
- Rate limiting accepts a `store` (`RedisRateLimitStore` for multi-instance limits).

---

## 1.2.x → 2.0.0

Two breaking changes from the security/performance hardening pass.

---

### 1. `JWTProvider` methods are now `async`

`verifyAccessToken`, `verifyRefreshToken`, `refreshAccessToken`, `blacklistToken`, `isBlacklisted`, and `cleanupBlacklist` now return `Promise`s instead of resolving synchronously. This was required to fix a security issue (see below) and to support pluggable, Redis-backed token revocation for multi-instance deployments.

```typescript
// Before
const payload = jwtProvider.verifyAccessToken(token);
jwtProvider.blacklistToken(token);

// After
const payload = await jwtProvider.verifyAccessToken(token);
await jwtProvider.blacklistToken(token);
```

Also fixed alongside this change: `verifyAccessToken()` previously did not reject refresh tokens — with the default configuration (no separate `refreshSecret`), a stolen refresh token could be replayed as an access token. It now rejects any token whose payload has `type === 'refresh'`.

New optional `JWTConfig` fields: `privateKey` / `publicKey` (required when `algorithm` is `RS256`/`RS384`/`RS512` — previously these algorithms were declared but silently signed with the shared `secret`), and `blacklist` (a `TokenBlacklist` implementation; defaults to `MemoryTokenBlacklist`, use `RedisTokenBlacklist` for multi-instance revocation).

---

### 2. Decorator-based controllers default to `singleton` scope, not `transient`

Controllers previously got a **new instance on every request**. They are now resolved as `singleton` by default — the standard convention (matches NestJS) and a meaningful performance win, since transient resolution re-read constructor dependency metadata on every request.

**If your controller stores per-request state in instance fields**, that state is now shared across concurrent requests — move it to a method-local variable, a request-scoped dependency (`@Depends(Thing, { scope: 'request' })`), or opt back into per-request instances explicitly:

```typescript
@Controller('/users', { scope: 'transient' }) // opt out of the new default
class UserController { ... }
```

---

## 0.x → 1.0.0

Three breaking changes. All have straightforward fixes.

---

### 1. Replace `FastAPITS` with `Veloce`

`FastAPITS` is removed. It was deprecated in v0.4.1.

```typescript
// Before
import { FastAPITS } from 'veloce-ts';
const app = new FastAPITS({ title: 'My API' });

// After
import { Veloce } from 'veloce-ts';
const app = new Veloce({ title: 'My API' });
```

`VeloceTS` is also valid if you prefer the full name:

```typescript
import { VeloceTS } from 'veloce-ts';
const app = new VeloceTS({ title: 'My API' });
```

---

### 2. WebSocketPlugin throws on Node.js at startup

Previously `WebSocketPlugin` silently returned HTTP 501 on every upgrade request when running on Node.js. In 1.0.0 it throws at `app.usePlugin()` time.

**If you run on Bun or Deno** — no change needed. WebSocket works the same.

**If you run on Node.js** — remove `WebSocketPlugin` for now. Node.js WebSocket support is not yet implemented. Either:

```typescript
// Option A: guard by runtime
const isBun = typeof Bun !== 'undefined';
if (isBun) {
  app.usePlugin(new WebSocketPlugin({ ... }));
}

// Option B: remove WebSocket until Node.js support lands
```

---

### 3. Remove `@InjectDrizzleRepository` usages

The decorator was a no-op stub that logged a warning and did nothing. Remove any imports or usages:

```typescript
// Remove this — it never worked
import { InjectDrizzleRepository } from 'veloce-ts';

@InjectDrizzleRepository()  // remove
userRepo: UserRepository;
```

Use constructor injection with `@Depends` instead:

```typescript
import { Controller, Get, Depends } from 'veloce-ts';
import { UserRepository } from './user.repository';

@Controller('/users')
class UserController {
  @Get('/')
  async list(@Depends(UserRepository) repo: UserRepository) {
    return repo.findMany();
  }
}
```

---

### New in 1.0.0 — no action required

These additions are backwards-compatible:

- `OAuthPlugin`, `PermissionPlugin`, `SessionPlugin` now importable directly from `'veloce-ts'` (still also available from `'veloce-ts/auth'`)
- `registerPrisma(app, prismaClient)` — DI helper for Prisma
- `registerTypeORM(app, dataSource)` — DI helper for TypeORM

```typescript
import { registerPrisma, registerTypeORM } from 'veloce-ts';

// Prisma
registerPrisma(app, prisma);

// TypeORM
registerTypeORM(app, dataSource);
```

---

### Semver from 1.0.0 onwards

Veloce-TS follows [Semantic Versioning](https://semver.org/) from this release:

- **Patch** (1.0.x) — bug fixes, no API changes
- **Minor** (1.x.0) — new features, backwards-compatible
- **Major** (x.0.0) — breaking changes with migration guide

Check [CHANGELOG.md](CHANGELOG.md) before upgrading.
