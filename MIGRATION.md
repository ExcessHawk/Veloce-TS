# Migration Guide

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
