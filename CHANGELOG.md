# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.2.0] - 2026-09-07

### Added — WebSockets work on Node

`WebSocketPlugin` threw at startup on Node ("requires Bun or Deno runtime"), which made the
`@WebSocket` / `@OnConnect` / `@OnMessage` decorators — and the `websocket` and `fullstack`
templates — unusable there. It was the framework's number-one documented limitation.

Node now upgrades through [`@hono/node-ws`](https://www.npmjs.com/package/@hono/node-ws), an
optional peer dependency. Bun and Deno are untouched: they still upgrade natively and need no
extra package.

```bash
npm install @hono/node-ws   # only needed on Node
```

The whole gateway surface is verified end-to-end on Node in CI (`npm run test:websocket`):
upgrade handshake, `@OnConnect`, `@OnMessage`, rooms, `broadcast()` and `@OnDisconnect`. The
template smoke test now boots all four templates instead of skipping the two that could not run.

`authorizeUpgrade()` still runs, with one difference worth knowing: on Bun and Deno an
unauthorized client is refused during the handshake with **401**, while `@hono/node-ws` owns the
route and hands the socket over already open, so on Node the connection is accepted and then
closed with **1008 Policy Violation**.

### Fixed

- **`WebSocketConnection` read `WebSocket.OPEN` off the global**, which only became stable in
  Node 22 — on Node 20, which `engines` still supports, touching it threw a `ReferenceError`. It
  now uses the numeric constant fixed by the standard.
- The manager's socket parameters are typed structurally (`WebSocketLike`) instead of against the
  DOM `WebSocket`, so a Bun socket, a Deno one and node-ws's `WSContext` all fit.

### Added — internals

- `VeloceTS.getServer()` exposes the running server, and `ServerInstance.raw` carries the
  runtime's own object. The Node backend's returned instance is a spread copy that has lost
  `http.Server`'s prototype, so anything needing the real server — attaching a WebSocket upgrade
  listener, for one — has to use `raw`.

## [3.1.2] - 2026-09-07

### Changed

- **Production builds no longer emit sourcemaps, cutting the published package by ~69%.**
  Bun embeds each source file's full text in the map through `sourcesContent`, and with both an
  ESM and a CJS build that meant shipping the entire TypeScript source twice: sourcemaps were
  **73% of the tarball**. Every install paid for it, to serve the rare case of stepping into
  framework internals with a debugger — clone the repo for that instead.

  | | Packed | Unpacked |
  |---|---:|---:|
  | 3.1.1 | 1.47 MB | 6.9 MB |
  | 3.1.2 | 0.41 MB | 1.73 MB |

  Development builds (`bun run build`) keep inline sourcemaps, which is where they are actually
  used.

- **Declaration maps are no longer emitted either.** The 256 `.d.ts.map` files resolved to
  `../../src/*.ts`, and `files` does not publish `src/` — so they were 351 KB of maps pointing at
  nothing in an installed package.

## [3.1.1] - 2026-09-07

### Fixed — the published types were unusable on `node16`/`nodenext`

- **Every relative specifier in the declarations lacked a file extension**, so any consumer on
  `moduleResolution: node16` or `nodenext` got nothing but `TS2834` ("Relative import paths need
  explicit file extensions") from `node_modules/veloce-ts` and lost all types. The 332 relative
  specifiers across `src/` now carry an explicit `.js`, which Bun resolves back to the `.ts`
  source and `bundler` resolution accepts unchanged.
- **`require('veloce-ts')` was rejected by TypeScript** with `TS1479` ("the referenced file is an
  ECMAScript module and cannot be imported with 'require'") even though it works at runtime. One
  declaration tree was shared by both conditions, and TypeScript infers a `.d.ts` file's module
  kind from the nearest `package.json` — the root says `"type": "module"`, so the types claimed
  ESM while `require` resolved to `dist/cjs`. The build now emits `dist/types-cjs` with a
  `commonjs` marker and each `exports` condition carries its own `types`.
- **`WebSocketManager.handleMessageBun` typed a parameter as `Buffer`**, which forced consumers to
  install `@types/node` just to type-check an import of the package. It is `Uint8Array` now —
  `Buffer` extends it, so what Bun passes still fits.

### Added

- `test:package` now verifies that each `import`/`require` condition serves declarations of the
  matching module system, so a types/runtime mismatch fails the build instead of reaching npm.

## [3.1.0] - 2026-09-07

### Fixed — the CLI produced projects that could not run

- **`veloce new` scaffolded an app that crashed on startup.** The `rest` and `fullstack`
  templates emitted `cors: { origin: '*', credentials: true }` — the combination 3.0.0 started
  rejecting at construction time — so a freshly created project died before serving a request.
  Templates now list explicit origins (overridable through `CORS_ORIGINS`).
- **`veloce build` failed under Node** with `ReferenceError: Bun is not defined`: it called
  `Bun.build` unconditionally. It now compiles with the project's own `tsc` when not running
  under Bun. Note that `Bun.build` is an in-process API, so the Bun path requires the CLI itself
  to be running under Bun — having the binary on `PATH` is not enough.
- **`veloce dev` only ever spawned `bun`.** It now detects the runtime and falls back to `tsx`,
  which transpiles the decorators Node's own type stripping cannot handle.
- **Compiled output was unloadable by Node.** Templates imported relative modules without a file
  extension, which `tsc` emits verbatim and Node's ESM loader rejects — `node dist/index.js`
  died with `ERR_MODULE_NOT_FOUND`. Templates (and `veloce generate` output) now write the `.js`
  extension, which Bun resolves back to the `.ts` source.
- **The `websocket` and `fullstack` templates passed a `handlers` option that does not exist** on
  `WebSocketPluginConfig`, so a generated project failed to type-check. Gateways are registered
  with `app.include()`, like controllers.
- `veloce dev` no longer spawns with `shell: true`, which concatenates rather than escapes
  arguments — Node reports it as DEP0190, and project paths routinely contain spaces.

### Added

- **`--runtime <auto|bun|node>`** on `veloce dev` and `veloce build`. `auto` prefers Bun when it
  is usable and otherwise runs the Node path.
- Generated projects are now runtime-agnostic: scripts route through the `veloce` binary instead
  of hardcoding `bun`, `engines.node` is `>=20`, `@hono/node-server` is included so `listen()`
  works under Node, `tsx` is a devDependency for the Node dev server, and a `typecheck` script
  is included. The `generate:*` scripts pointed at `bin/veloce.ts`, the Bun-only legacy entry.

## [3.0.1] - 2026-09-05

### Fixed

- **`MemoryRateLimitStore` and `RedisRateLimitStore` were not exported.** 3.0.0 introduced the
  pluggable rate-limit store and documented it, but neither class was re-exported from
  `veloce-ts` or `veloce-ts/middleware`, so `RateLimitOptions.store` could not actually be
  supplied by a consumer. Both are now exported from both entry points; the `RateLimitStore`
  and `RateLimitHit` types were already reachable via `veloce-ts/types`.

## [3.0.0] - 2026-09-05

Full-codebase review of 2026-09-04 (`REVIEW-2026-09-04.md`, 36 items). Fourteen defects were
first reproduced with failing HTTP-level tests; those now live in `tests/guards.test.ts`.

### Security

- **Route guards declared by `@Auth()`, `@Session()`, `@RequireCSRF()` and the `@CanAccess`
  family were never enforced.** `AuthPlugin`, `SessionPlugin` and `PermissionPlugin` each
  reassigned `app.compile` from inside their own `install()` — but `install()` runs from
  *within* the already-executing `VeloceTS.compile()`, so the replacement function was never
  called. In practice an `@Auth()` route without a `@CurrentUser()` parameter answered
  **200 to anonymous requests**, `@Auth({ roles: ['admin'] })` admitted any authenticated
  user, and `@Session({ required: true })` / `@RequireCSRF()` did nothing at all. All three
  plugins now inject their guard into the route's middleware during `install()`, the same way
  `RBACPlugin` already did. **Applications relying on these decorators were unprotected and
  should update.**
- **Session cookies are now signed** with `SessionConfig.secret` (HMAC-SHA256, verified in
  constant time). The cookie previously carried the raw session id, so anyone could swap in
  another id and be handed that session. `secret` is now required, and cookies default to
  `secure: true` under `NODE_ENV=production`.
- **Refresh-token rotation is atomic.** `refreshAccessToken()` verified the token and only then
  blacklisted it, so two concurrent requests with the same refresh token both succeeded and each
  received a valid new pair. The old token is now claimed (`SET NX` on Redis, check-and-set in
  memory) before a new pair is minted; the loser fails.
- **Request bodies are size-limited.** New `VeloceTSConfig.bodyLimit` (default 1 MiB, `0`
  disables) rejects oversized bodies with 413 before any handler reads them.
- **Cached responses can vary by caller.** `@Cache()` now honours `varyByHeaders` and a new
  `keyGenerator(c)`; previously the key was method + path + params only, so a cached
  per-user route could serve one user's body to another. A route that reads
  `@CurrentUser()`/`@Token()`/session data while caching under a caller-independent key now
  logs a warning at compile time.
- **Auth flows no longer report internal failures as 401.** A database outage inside
  `login`/`register`/`refresh` was wrapped into `AuthenticationException(error.message)`,
  reporting an infrastructure fault as bad credentials and leaking the internal message.
  Only real credential failures stay 401; anything else is logged and surfaces as 500.
- **WebSocket handler errors are no longer echoed to the client.** Only parse/schema problems
  (which describe the client's own input) are returned; everything else is logged server-side
  and answered with a generic error.
- **JWT revocation entries are keyed by `jti`** instead of the full token, so the blacklist no
  longer stores replayable credentials.
- **CORS**: `Vary: Origin` is emitted whenever the allowed origin depends on the request, and
  `origin: '*'` combined with `credentials: true` now throws at configuration time instead of
  producing responses browsers silently reject.
- **`Response.file()` gained a `root` option** (plus `Response.fileFrom(root, path)`) that
  confines the lookup to a directory; paths escaping it get 403. The previous docstring showed
  `'./uploads/' + filename` straight from a route parameter, which is a path-traversal recipe.

### Fixed

- **Class-level `@UseInterceptor` never ran.** The lookup read `target.constructor` on a value
  that was already the class, so it resolved to `Function` and found nothing.
- **Exception filters never saw validation or dependency-injection errors** — those were caught
  by an outer handler that bypassed `FilterManager`. Errors thrown by route middleware/guards now
  reach filters too.
- **`DIContainer` reported false circular dependencies under concurrency.** The resolution stack
  was one container-wide `Set`, so two simultaneous resolves of the same async provider accused
  each other. Resolution paths are now per async context (`AsyncLocalStorage`), genuine cycles are
  still detected, and concurrent first-time singleton resolves share one in-flight promise so
  exactly one instance is created.
- **Two controllers with the same class name silently overwrote each other's routes.** The route
  registry keyed on `target.name`; it now keys on class identity.
- **`VeloceTSConfig.docs` and `.plugins` were accepted and ignored.** `docs` now mounts the
  OpenAPI plugin (`/openapi.json` + `/docs`, configurable, skipped when an `openapi` plugin is
  registered manually) and `plugins` registers each entry. The `veloce new` templates and every
  bundled example already passed `docs: true`.
- **A malformed JSON body returned 422 "Expected object, received null".** The parse error was
  swallowed and `null` handed to Zod; it is now a 400 that names the JSON problem.
- **`AuthService.refresh()` was missing an `await`**, so its `catch` never ran and callers got a
  bare `Error` instead of `InvalidTokenException`.
- **Node's `listen()` could never work.** The Node path used `require('@hono/node-server')`, and
  the published ESM bundle has no `require` in scope, so it always threw and was reported as
  "package not installed". It now uses a dynamic import; `Adapter.listen` may return a promise.
- **SSE/streaming generators that throw** now error the stream and log, instead of producing an
  unhandled rejection. The per-chunk `TextEncoder` allocation was hoisted out.
- **`HTTPException`s thrown by a DI factory** kept their status instead of being flattened into a
  generic 500; other failures keep the original error as `cause`.
- **`process.on('SIGTERM'/'SIGINT')` listeners registered by the rate limiter and
  `MemorySessionStore`** suppressed Node's default signal handling for the whole application (a
  script that merely constructed one stopped exiting on Ctrl+C). Both now `unref()` their timer.
- Flaky WebSocket heartbeat test given realistic margins.

### Added

- `RateLimitStore` contract with `MemoryRateLimitStore` (default) and `RedisRateLimitStore`, so a
  rate limit can be enforced across instances rather than per process.
- Typed context variables: `ContextVariableMap` is augmented for `auth.user`, `auth.token`,
  `session`, `routeMetadata` and the rest, so `c.get('auth.user')` is typed and a mistyped key is
  a compile error.
- `veloce-ts` now exports the response builder as **`VeloceResponse`** (and `Res`). The old
  `Response` export shadowed the global Web API `Response` in any file that imported it; it
  remains available as a deprecated alias.

### Changed

- `engines.node` raised to `>= 20` (Node 18 is end-of-life). `@hono/node-server` is declared as an
  optional peer dependency. CI moved to `setup-bun@v2` / `setup-deno@v2`, Deno 2.x, Bun 1.3.x.
- `MetadataCompiler` caches by route-object identity (a `WeakMap`) instead of hashing a snapshot
  per route; `ValidationEngine`'s "schema cache" was a no-op wrapper and has been removed
  (`getCacheStats()` is deprecated but still present).
- `build.ts` exits non-zero when the build throws — it previously logged and exited 0.
- Spanish module-header JSDoc across `src/` translated to English for consistency.


## [2.0.2] - 2026-07-26

### Fixed

- **Importing `veloce-ts` kept a Node process alive.** `CacheManager` built its default `MemoryCacheStore` eagerly at class-definition time, and that store starts a cleanup `setInterval` — so merely importing the framework was enough to stop a short-lived script (a CLI, a codegen task) from ever exiting on its own. The default store is now created on first use, and `reset()`/`destroy()` leave it uncreated until something needs it again. Long-running servers are unaffected.


## [2.0.1] - 2026-07-26

### Fixed

- **Refresh tokens were not unique.** The payload was only `{sub, type, iat, exp, iss, aud}`, so two refresh tokens minted for the same user within the same second were byte-identical. That collides in a database unique index, and because both sessions held literally the same string, revoking or rotating one silently invalidated the other. Every token now carries a `jti` (`randomUUID()`).
- **Access tokens now carry a `jti` too**, so an application keeping a revoked-token registry keyed by `jti` can also match tokens issued by `refreshAccessToken()`, not just those from an explicit login. A caller-supplied `jti` in the payload still takes precedence.
- **`refreshAccessToken()` no longer copies the old refresh token's `jti`** into the rotated pair — a per-token identifier must not outlive the token it belongs to.


## [2.0.0] - 2026-07-26

### Security

- **Fixed:** refresh tokens could be replayed as access tokens. `JWTProvider.verifyAccessToken()` now rejects any payload with `type === 'refresh'`, mirroring the check `verifyRefreshToken()` already had.
- **Fixed:** `RS256`/`RS384`/`RS512` were accepted as `JWTConfig.algorithm` but signing always used the shared `secret`. Added `privateKey`/`publicKey` config fields; asymmetric algorithms now throw at construction if the matching key is missing.
- **Fixed:** the default rate-limit `keyGenerator` trusted `X-Forwarded-For`/`X-Real-IP` unconditionally, letting any client spoof its rate-limit identity. These headers are now ignored unless the new `trustProxy: true` option is set; the untrusted default falls back to the real peer IP (Bun) or `'unknown'`.
- **Fixed:** `@ResponseSchema` validation failures were silently swallowed, letting malformed handler output pass straight to the client. They now log and return 500.

### Changed (breaking — see [MIGRATION.md](MIGRATION.md))

- `JWTProvider.verifyAccessToken`, `verifyRefreshToken`, `refreshAccessToken`, `blacklistToken`, `isBlacklisted`, `cleanupBlacklist` are now `async`, to support pluggable token revocation stores (`TokenBlacklist` — `MemoryTokenBlacklist` default, new `RedisTokenBlacklist` for multi-instance deployments).
- Decorator-based controllers now resolve as `singleton` by default instead of `transient` (new instance per request). Opt back in with `@Controller(prefix, { scope: 'transient' })`.

### Added — tooling & CI

- CI now runs a real multi-runtime matrix: Bun (pinned + latest, on ubuntu/windows/macos), a **Node 20/22 smoke job** that builds and then imports both `dist/esm` and `dist/cjs` under real Node, an allow-failure Deno leg, an isolated package-validation job, and a coverage job that gates and uploads its report.
- `scripts/check-coverage.ts` — coverage gate over `src/**` only (bun's own total is diluted by `dist/`, `examples/` and the tests themselves). Threshold starts at 50%, just under the measured baseline, so it blocks regressions instead of failing on day one.
- `scripts/smoke-node.mjs` — imports the built ESM and CJS entrypoints under Node, boots an app and asserts a real request round-trips.
- `bin/veloce.mjs` — Node-compatible CLI launcher (`#!/usr/bin/env node`). The `bin` entry previously pointed at a `#!/usr/bin/env bun` TypeScript file, so the CLI could not run without Bun despite the package advertising Node >= 18.
- `scripts/test-package.ts` now verifies every `exports` condition resolves to a file that exists on disk, and type-checks a generated consumer file (all 15 entrypoints plus a Zod-validated route) against `dist/types` with real `tsc --strict`. This is what caught the broken `adapters/*` paths above.
- Type-declaration generation failure is now **fatal** in `--production` builds; it previously warned and continued, so a release could ship broken `.d.ts` with a green pipeline.
- `veloce generate openapi` now builds its spec with the real `OpenAPIGenerator` instead of a hand-rolled builder that ignored Zod, and the generated TypeScript client emits real interfaces derived from the schemas (falling back to `unknown`, never `any`) instead of typing every method `Promise<any>`.

### Added

- `RouteConfig`/functional API (`app.get/post/put/delete/patch`, `app.route()`) is now generic over the declared Zod schema bag — handler arguments (`body`, `query`, `params`, `headers`) are inferred end-to-end, no manual casts needed.
- Plugin lifecycle hooks: `Plugin.onStart(app)` (after the server starts listening) and `Plugin.onStop(app)` (during graceful shutdown / `app.shutdown()`, reverse install order).
- `LoggerConfig.pretty` is now honored via a `pino-pretty` transport when the package is installed.
- `@Controller(prefix, { scope })` — explicit per-controller instantiation scope (`singleton` | `request` | `transient`).
- `CacheManager.destroy()` — releases every registered store's resources (timers, connections) without replacing them; call it on shutdown so a `MemoryCacheStore` cleanup interval can't keep the process alive.
- `VeloceTS.getFetchHandler()` — returns the `fetch(request, env, ctx)` export shape serverless/edge runtimes expect, the supported deploy path for Cloudflare Workers where `listen()` cannot work. Auto-compiles on first call.

### Fixed — packaging (the published package was broken for Node consumers)

- **`veloce-ts/adapters/*` did not resolve.** The `exports` map pointed `import`/`require` at `./dist/{esm,cjs}/adapters/*.js`, but the build emits `./dist/{esm,cjs}/src/adapters/*.js` — so the `import { ExpressAdapter } from 'veloce-ts/adapters/express'` shown in the README failed for every consumer. (The `types` condition on the same entry was already correct, which is why it type-checked but crashed at runtime.)
- **Runtime dependencies are no longer bundled into `dist`.** Only veloce-ts's own `src/` is bundled now; everything in `dependencies`/`peerDependencies`/`optionalDependencies` is externalized. Bundling them shipped a second copy of each, which:
  - broke **Zod identity** — the framework checks schemas the user built with *their* zod, and a bundled copy is a different class, so those checks silently stopped matching;
  - re-transpiled third-party code, which mangled `semver` (pulled in via `jsonwebtoken`) into an **invalid RegExp that threw on require under Node**;
  - inflated the published package. It is now **1.33 MB, down from 3.82 MB**.
- **ESM bundle crashed under real Node.** It was built with Bun's `bun` target, which emits the Bun-only `import.meta.require` global; switched to the `node` target (still runs fine under Bun).
- **`import { sign } from 'jsonwebtoken'` broke Node's ESM loader.** `jsonwebtoken` is CJS-only, so named ESM imports throw `SyntaxError: Named export 'sign' not found` under Node (Bun tolerates it). Now imported via its default export.
- **`dist/cjs/*.js` was parsed as ESM by Node**, because the root `package.json` declares `"type": "module"`. The build now emits `dist/cjs/package.json` with `{"type":"commonjs"}`.

### Fixed

- Redis-backed cache (`RedisCacheStore`) and session store (`RedisSessionStore`) used the blocking `KEYS` command for `clear()`/`deletePattern()`/`length()`/`all()`; both now use cursor-based `SCAN` (with a `KEYS` fallback for clients lacking `scan()`) plus batched `DEL`.
- In-memory cache's "LRU" eviction was actually FIFO (ordered by creation time, not last access) — `get()` now re-inserts the entry so eviction order tracks true recency.
- `Response.file()` threw on non-Bun runtimes; now streams the file via `node:fs` on Node/Deno.
- Two separate SIGTERM/SIGINT handlers were registered with competing shutdown timeouts; consolidated into one that closes the server, then runs `onShutdown` handlers, then plugin `onStop` hooks.
- `EventBus.emit`/`emitSync`: a throwing listener no longer aborts the remaining listeners; errors are collected and re-thrown together as an `AggregateError` once every listener has run.
- Query parameters were validated twice per request (once ad hoc, once via the shared validator) with inconsistent error shapes; now validated once.
- Fixed a double-rollback in `BaseTransactionManager.executeInNewTransaction`: when a handler completed successfully but the transaction was marked `rollbackOnly`, the resulting error was re-caught by the same try/catch and triggered a second `rollback()` call, which threw "transaction not found" and masked the intended error.
- `BaseRepository.count()`/`updateMany()`/`deleteMany()` now throw `NotImplementedError` instead of silently loading every row into memory; all three ORM adapters (Drizzle, Prisma, TypeORM) already provide native overrides.
- GraphQL: resolvers are now actually invoked (previously wired to a `rootValue` shape `graphql-js` never reads, so every query returned `null`), and field/argument types are derived from Zod schemas / `@Returns` metadata instead of being hardcoded to `String`.
- The route "compiled metadata" layer (`MetadataCompiler`) precomputed a path regex, parameter/dependency index order, and type flags that the request handler never read; replaced with dense, pre-sorted parameter/dependency arrays that the hot path does consume, and controller/interceptor resolution moved out of the per-request path into `compile()` time.
- `CacheManager.reset()` leaked the previous store's cleanup `setInterval` — repeated calls (e.g. between test suites) accumulated timers and could keep a process alive indefinitely. It now destroys stores before replacing them.
- `app.shutdown()` never ran registered `onShutdown()` handlers — only the SIGTERM/SIGINT path did, so programmatic shutdown silently skipped user cleanup. It now runs the same teardown (server close → `onShutdown` handlers → plugin `onStop` hooks).
- The Express adapter buffered whole response bodies via `.json()`/`.text()`/`.arrayBuffer()`, which broke SSE (`@SSE`) and `@Stream` routes (clients received nothing until the generator finished) and forced a serialize/reserialize round-trip on every JSON response. Responses are now streamed chunk-by-chunk with backpressure handling.

## [1.2.0] - 2026-06-27

### Added

- **CLI code generation** (`veloce generate`): scaffold controllers, services, modules, resolvers, DTOs, middleware, and plugins with a single command. `veloce new <name>` creates a full project with correct tsconfig and dependencies.
  ```bash
  veloce generate module school      # controller + service + dto + barrel
  veloce generate controller users   # @Controller with full CRUD stubs
  veloce generate resolver product   # @Resolver with @GQLQuery/@GQLMutation
  veloce generate plugin cache       # Plugin interface implementation
  ```

- **Graceful shutdown** (`app.onShutdown()`): register async cleanup handlers executed on SIGTERM/SIGINT in reverse order, with a configurable timeout (default 30 s).
  ```typescript
  app.onShutdown(async () => { await db.end(); });
  app.setShutdownTimeout(10_000);
  ```

- **Exception filters** (`@Catch`, `app.useFilter()`): centralised error handling per error class — no more try/catch in every controller.
  ```typescript
  @Catch(DrizzleError)
  class DBFilter implements ExceptionFilter {
    catch(err: DrizzleError, c: Context) { return c.json({ error: 'DB error' }, 500); }
  }
  app.useFilter(new DBFilter());
  ```

- **Interceptors** (`@UseInterceptor`, `app.useInterceptor()`): AOP middleware around handlers — logging, caching, retries, transforms.
  ```typescript
  app.useInterceptor(new LoggingInterceptor());
  @UseInterceptor(CacheInterceptor)
  @Get('/users') async getUsers() { ... }
  ```

- **Streaming responses** (`@SSE()`, `@Stream(contentType)`): return `AsyncGenerator` from any handler for SSE or raw byte streams.
  ```typescript
  @Get('/events') @SSE()
  async* stream() { yield { data: 'ping' }; }

  @Get('/export.csv') @Stream('text/csv')
  async* csv() { yield 'id,name\n'; yield* rows; }
  ```

- **Event bus** (`EventBus`, `globalEvents`): lightweight in-process pub/sub with `on`, `once`, `off`, async `emit`, and `emitSync`.
  ```typescript
  globalEvents.on('user.created', async ({ userId }) => { ... });
  await globalEvents.emit('user.created', { userId });
  ```

- **Extra decorators**:
  - `@Throttle(limit, windowMs)` — per-endpoint rate limit override
  - `@ApiVersion('v2')` — prefix route with version segment
  - `@ResponseHeader(name, value)` — set response header declaratively
  - `@Redirect(url, status?)` — 301/302/307/308 redirect
  - `@Deprecated(message?)` — marks route in OpenAPI + emits warning

- **Test isolation utilities** (`veloce-ts/testing`): `isolate()` resets shared singleton state between bun test files; `compileTestApp(app)` compiles and returns the Hono instance in one call.

- **OpenAPI 3.1** output: `openapi: '3.1.0'`, `jsonSchemaDialect` field, `nullable: true` replaced with JSON Schema 2020-12 type arrays (`{ type: ['string', 'null'] }`), full `oneOf` fallback for complex unions.

- **Benchmarks suite** (`benchmarks/`): `bun run benchmark` runs autocannon against veloce-ts, Hono, and Fastify across hello/json/params/validation routes and prints a comparison table.

### Fixed

- GraphQL templates in `veloce new` used `@Query`/`@Mutation` (wrong) — corrected to `@GQLQuery`/`@GQLMutation` with proper `veloce-ts/graphql` imports.

## [1.0.1] - 2026-06-26

### Fixed

- **GraphQL decorator pipeline wired up.** `@Resolver`, `@GQLQuery`, `@GQLMutation`, `@GQLSubscription`, and `@Arg` decorators now correctly connect to `GraphQLPlugin`. Previously the decorators wrote metadata using local symbols that `GraphQLSchemaBuilder` never read — the schema was always empty.

  Pass resolver classes to the plugin via the new `resolvers` option:
  ```typescript
  app.usePlugin(new GraphQLPlugin({ resolvers: [UserResolver, PostResolver] }));
  ```
  Or register them with `app.include()` before calling `usePlugin()`:
  ```typescript
  app.include(UserResolver);
  app.usePlugin(new GraphQLPlugin());
  ```

- **`PermissionManager.revokePermission()` bug fixed.** When called without a `resourceId`, the filter condition `resourceId ? p.resourceId !== resourceId : true` always returned `true` (kept all records, removed nothing). Now correctly removes all permissions for the user+resource pair when no `resourceId` is specified.

- **`app.include()` now recognises `@Resolver` classes.** Previously silently ignored — now registers resolver metadata into `MetadataRegistry` so `GraphQLPlugin` can pick it up automatically.

### Added

- **89 new tests** (507 total, 0 failures) covering:
  - GraphQL decorator metadata pipeline end-to-end
  - `app.include()` + `resolvers: []` option merge
  - `PermissionPlugin` construction, `PermissionManager` unit logic, management route auth guards
  - `HealthCheckPlugin` `/health`, `/ready`, `/live` endpoints, custom check logic, `HealthCheckers` factory
  - `OAuthPlugin` route behavior, `BaseOAuthProvider`/`GoogleOAuthProvider`/`GitHubOAuthProvider`, `OAuthStateManager`, `PKCEUtils`
  - Logger (`createLogger`, `getLogger`, `initializeLogger`, `createChildLogger`, child context propagation)

## [1.0.0] - 2026-06-26

First stable release. Establishes a frozen public API with semver guarantees going forward.

### Breaking Changes

- **`FastAPITS` export removed.** Use `VeloceTS` or the `Veloce` alias instead.
  ```typescript
  // Before
  import { FastAPITS } from 'veloce-ts';
  // After
  import { Veloce } from 'veloce-ts';
  ```

- **`WebSocketPlugin` throws on Node.js at install time** instead of silently returning 501 at request time. If you were catching the 501 response, catch the constructor error instead. WebSocket is supported on Bun and Deno only.
  ```typescript
  // Node.js — throws Error('WebSocketPlugin requires Bun or Deno runtime...')
  app.usePlugin(new WebSocketPlugin({ ... }));
  ```

- **`@InjectDrizzleRepository` decorator removed.** It was a no-op stub. Remove any usages — the decorator did nothing at runtime.

### Added

- **`OAuthPlugin`, `PermissionPlugin`, `SessionPlugin`** now exported from the main `'veloce-ts'` barrel (previously only from `'veloce-ts/auth'`).
- **`registerPrisma(app, client)`** — thin DI helper for Prisma, mirrors `registerDrizzle`. Exports `PRISMA_TOKEN`.
- **`registerTypeORM(app, dataSource)`** — thin DI helper for TypeORM. Exports `TYPEORM_TOKEN`.

### Fixed

- **TypeScript errors** — 12 pre-existing errors resolved: route param casts in auth plugins, `PrismaDelegate` missing `createMany`, middleware spread type mismatch in `RouterCompiler`.
- **RouterCompiler** dead `compiledRoutes` Map removed — it was write-only and shared the same class-name collision bug that was already fixed in `MetadataCompiler`.
- **Branding** — "FastAPI-TS" replaced with "Veloce-TS" in all error messages and JSDoc across `src/adapters/hono.ts`, `src/orm/prisma/plugin.ts`, `src/orm/typeorm/plugin.ts`, `src/orm/typeorm/decorators.ts`, `src/orm/transaction-plugin.ts`.

### Test coverage

413 tests passing, 0 failures across 21 files. New files added:
- `tests/websocket.test.ts` — 11 tests (decorator registration, plugin construction on Bun, upgrade route, auth guards)
- `tests/graphql.test.ts` — 10 tests (plugin install, invalid JSON, GET/POST, playground, introspection)

## [0.4.18] - 2026-06-25

Full security & correctness audit across the framework core, auth layer, ORM integrations, and build pipeline. 375 tests passing, 0 failures.

### Fixed

**Auth / Security**
- **RBAC plugin:** all 7 management routes (`/roles`, `/users/:id/roles`, etc.) now correctly require `requireAuth`. Previously they were publicly accessible.
- **Permission plugin:** all 7 permission management routes now correctly require `requireAuth`. Same gap as RBAC.
- **JWT blacklist:** replaced the `Set<string>` with `Map<string, number>` (token → expiry timestamp). Provides O(1) lookup and enables `cleanupBlacklist()` to auto-purge expired entries without scanning the entire set.
- **OAuth plugin:** `login()` returned 401 on valid credentials due to an inverted conditional; fixed. PKCE code TTL was set to `Date.now()` (milliseconds) instead of `Date.now() / 1000` (seconds), causing immediate expiry.
- **Auth plugin:** removed 5 `console.log()` debug calls leaking tokens and user data to stdout in production builds.
- **Auth service:** `hashPassword()` was gated by an incorrect production guard that blocked legitimate use; removed.

**Core**
- **MetadataCompiler:** cache key changed from `"ClassName:methodName"` to a WeakMap-based numeric class identity (`targetId:methodName`). Fixes 36 test failures when running Bun's shared-process test runner: classes with the same name in different test files no longer share a cache slot, so each app instance compiles its own routes with its own DI/JWT context.
- **MetadataRegistry:** `getRouteMethods()` now walks the full prototype chain. Inherited route methods from a base controller were previously invisible to the router compiler.
- **Application:** `createAdapter()` is now `async` and properly `await`ed. `listen()` is awaited. Timeout middleware and cache configuration now propagate correctly to the adapter.
- **CacheManager:** added `static reset()` to clear all stores and registered names — required for test isolation between app instances in the same process.

**ORM**
- **Base repository:** `createMany()` now uses `Promise.all()` for parallel execution instead of sequential `await` in a loop.
- **Prisma repository:** fixed double insert in `create()` — the entity was being saved twice.
- **Drizzle transaction manager:** `commit()` was called inside `finally` block, running even after a successful commit. Moved to the normal path only.
- **TypeORM transaction manager:** `QueryRunner` was not released on error, leaking database connections.
- **Drizzle repository:** static `import` of `drizzle-orm` at module top level replaced with lazy `require()` via `getDrizzleOps()`. Fixes build failure when `drizzle-orm` is not installed (optional peer dep).
- **TypeORM repository:** same fix — static `import` of `typeorm` replaced with lazy `getTypeORMOps()`.

**Build**
- **`build.ts`:** added `external` array to both `Bun.build()` calls covering all optional peer deps (`drizzle-orm`, `typeorm`, `prisma`, `@prisma/client`, `reflect-metadata`, `graphql`, `ioredis`, `express`, `hono`). Without this, `bun run build` failed when any optional dep was absent.

**Other**
- **GraphQL plugin:** `JSON.parse()` on the `variables` field now wrapped in try-catch; previously threw an unhandled exception on malformed JSON.
- **Session store:** auto-cleanup interval registered on construction; SIGTERM/SIGINT handlers stop it on shutdown (prevents hanging processes).
- **Rate limit middleware:** SIGTERM/SIGINT cleanup for the cleanup interval — same pattern.
- **Validator:** removed dead `resultCache` WeakMap that accumulated entries without any code path reading from it.

### Added

**Tests**
- `tests/fixes.test.ts` — 45 integration tests covering all 24 corrected bugs above (JWT blacklist Map behavior, RBAC/Permission auth guards, CacheManager.reset(), prototype chain routing, parallel createMany, MetadataCompiler class identity, lazy ORM imports, GraphQL JSON parse errors, session cleanup, functional route timeout/cache).
- `tests/cache.test.ts` — 40 tests for `parseTTL`, `MemoryCacheStore` (CRUD, TTL expiry, LRU eviction, pattern deletion), and `CacheManager` (reset, named stores, generateKey, convenience functions).
- `tests/session.test.ts` — 17 tests for `MemorySessionStore` (CRUD, touch, expiry with real-time wait, multi-session independence).

**Total test count: 375 pass, 0 fail** (was 273 before this release).

**Benchmarks**
- `benchmarks/internal.bench.ts` — 14 in-process micro-benchmarks measuring: JWT sign/verify/decode, Map-based blacklist lookup (77 M ops/s), MetadataCompiler cache-miss vs cache-hit (5× faster on hit), Zod `safeParse` valid/invalid, CacheManager get/set, DIContainer singleton resolution, and full Hono stack dispatch (GET simple, GET with param, POST with Zod body).
- Results saved to `benchmarks/results/internal-2026-06-25.txt`.

## [0.4.10] - 2026-05-12

### Fixed
- **WebSocket gateway DI injection:** `WebSocketPlugin.install()` now resolves each gateway from the DI container via `container.resolve(ws.target)` and stores the instance in the metadata. `WebSocketManager.executeHandler()` uses that pre-resolved instance instead of calling `new metadata.target()`, so constructor-injected dependencies (`@Inject`, `@InjectDB`) are available in all WebSocket event handlers (`@OnConnect`, `@OnMessage`, `@OnDisconnect`).

## [0.4.9] - 2026-05-03

### Changed
- **Dependencias actualizadas:** bump de todas las dependencias a sus últimas versiones patch/minor disponibles. Sin breaking changes.
  - `commander` 14.0.1 → 14.0.3
  - `hono` 4.12.12 → 4.12.16
  - `jsonwebtoken` 9.0.2 → 9.0.3
  - `zod-to-json-schema` 3.24.6 → 3.25.2
  - `ioredis` 5.8.2 → 5.10.1 (opcional)
  - `pino` 10.1.0 → 10.3.1 (opcional)
  - `pino-pretty` 13.1.2 → 13.1.3 (opcional)

## [0.4.8] - 2026-05-03

### Fixed
- **Logger transport eliminado:** se removió el uso de `pino-pretty` como `transport` en el logger de desarrollo. El transport de pino usa `thread-stream` para correr el pretty-printer en un worker thread, lo que causaba un crash al iniciar el servidor con el error `ModuleNotFound resolving "...thread-stream/lib/worker.js"` — el bundle publicado en npm tenía el `__dirname` de la máquina del autor hardcodeado (`C:\Users\alfredo\Desktop\...`). Ahora pino escribe JSON directo a stdout sin workers, eliminando la dependencia de `thread-stream` en runtime.

## [0.4.6] - 2026-04-12

### Fixed
- **Constructor injection en DIContainer:** `DIContainer.create()` ahora lee los metadatos de dependencias del constructor (`MetadataRegistry.getDependencyMetadata`) y resuelve cada dependencia antes de instanciar la clase. Anteriormente llamaba `new Class()` sin argumentos, causando que decoradores como `@InjectDB()` en parámetros de constructor no tuvieran efecto y las propiedades quedaran como `undefined`.
- **`@Depends` en parámetros de constructor:** eliminada la restricción que lanzaba error al usar `@Depends` en constructores. Ahora soporta tanto parámetros de método como de constructor.

### Added
- **`@Inject(Provider, scope?)` decorator:** nuevo decorador para inyección de dependencias en constructores, con scope `'singleton'` por defecto. Alternativa semántica a `@Depends` optimizada para el patrón de constructor injection en controllers y servicios.

## [0.4.5] - 2026-03-29

Mismo parche CORS que se intentó en **0.4.4**; npm **no permite republicar** un número de versión tras `npm unpublish` (`E400 Cannot publish over previously published version`).

### Fixed
- **CORS on error responses:** las respuestas del `ErrorHandler` (401, 422, 500, `application/problem+json`, etc.) incluyen `Access-Control-Allow-Origin` y el resto de cabeceras CORS configuradas, alineadas con respuestas OK (`veloce:corsHeaders` + `mergeVeloceCorsHeaders`). Export público: `mergeVeloceCorsHeaders`, `VELOCE_CORS_HEADERS_KEY`, `VeloceCorsHeadersSnapshot`.

## [0.4.4] - 2026-03-28

**No usar:** la release en npm llegó sin tarball servible (404). Tras `npm unpublish veloce-ts@0.4.4`, el registry **bloquea** volver a publicar el mismo número. El parche CORS válido está en **0.4.5**.

## [0.4.3] - 2026-03-27

### Added
- **RFC 9457 (Problem Details):** respuestas de error por defecto con `Content-Type: application/problem+json`, campos `type`, `title`, `status`, `detail`, `instance` y extensiones (`violations`/`details` en validación; `debug` en 500 solo en desarrollo).
- **`VeloceTSConfig.errorResponseFormat`:** `'rfc9457'` (defecto) o `'legacy'` para el JSON `{ error, statusCode, details? }` anterior.
- Helpers exportados: `problemTypeUri`, `resolveProblemType`, `resolveProblemTitle`, `buildProblemInstance`, `toLegacyErrorBody`, `sendErrorResponse`, constantes `PROBLEM_JSON_MEDIA_TYPE`, `DEFAULT_PROBLEM_TYPE_BASE`.
- **`HTTPExceptionOptions`:** `problemType` y `title` opcionales en el constructor de `HTTPException`.

### Changed
- Excepciones de auth (`AuthenticationException`, `AuthorizationException`) dejan de definir `toJSON` propio; heredan el formato unificado con URIs `authentication-error` / `authorization-error`.

### Documentation
- Cabeceras `@module` en el núcleo (application, metadata, router-compiler, plugin, compiled-metadata), errores, validación, DI, respuestas, logging, middleware, adapters, testing, barrels y más.
- **Benchmarks:** `benchmarks/run.ts` etiquetado como v0.4.3; `BENCHMARKS.md` y `benchmarks/results/latest.json` regenerados (6 000 req, 50 concurrentes, Bun 1.3.5, 2026-03-28).

### Notes
- El cuerpo JSON de error sigue incluyendo `error` y `statusCode` junto a los campos RFC 9457. Si tu cliente exige `Content-Type: application/json` en errores, usa `errorResponseFormat: 'legacy'` o acepta `application/problem+json`.

## [0.4.2] - 2026-03-27

### Fixed
- **HealthCheckPlugin:** checker display names are set with `Object.defineProperty` (with a fallback) so runtimes such as Bun do not throw when assigning `.name` on async checker functions.
- **Public API:** `@Req` is now exported from the main `veloce-ts` entry (it was implemented in `decorators/params` but missing from the package exports).

## [0.4.1] - 2026-03-27

### Fixed
- `include()` in `VeloceTS` application no longer drops decorator-set route fields (e.g. `statusCode` from `@HttpCode`, `responseSchema` from `@ResponseSchema`) when registering controller routes.

### Added
- New test suite: `tests/routing.test.ts`, `tests/validation.test.ts`, `tests/errors.test.ts`, `tests/di.test.ts` — 53 integration tests covering functional API, decorator routing, body/query validation, HTTP exceptions, and DI container.
- Console-based fallback logger: if `pino` is not installed, the framework now falls back silently to a `console`-based logger instead of crashing at startup.

### Changed
- `pino`, `pino-pretty`, and `ioredis` moved from `dependencies` to `optionalDependencies`. They are no longer installed automatically, reducing the default install footprint by ~7 MB. Install them explicitly if needed (`bun add pino pino-pretty` / `bun add ioredis`).
- `winston` removed from `dependencies` entirely (it was listed but never used by the framework).
- `@types/ioredis` and `@types/pino` removed from `devDependencies` (no longer needed).
- Build threshold in `build.ts` updated from 100 KB to 600 KB to reflect the full framework scope.
- Core bundle reduced from 444 KB to 408 KB (minified ESM).

### Deprecated
- `FastAPITS` export: use `VeloceTS` or the shorter `Veloce` alias instead. `FastAPITS` will be removed in v1.0.0.

## [0.4.0] - 2026-03-27

Esta versión representa la mayor actualización desde el lanzamiento inicial. Se añadieron más de 25 mejoras nuevas distribuidas en tres oleadas de trabajo (alta, media y baja prioridad), cubriendo la cadena completa desde la generación de rutas hasta la documentación OpenAPI, el testing, el ORM y la CLI.

### 🚀 Nuevos Decoradores

#### Documentación OpenAPI (shorthand)
Cinco decoradores de una sola línea como alternativa concisa a `@ApiDoc({...})`:
- **`@Summary(text)`** — descripción corta visible en la lista de Swagger UI
- **`@Description(text)`** — texto largo en el panel de detalle de la operación
- **`@Tag(name)`** — asigna un tag individual; apilable con múltiples `@Tag`
- **`@Tags(...names)`** — asigna varios tags en un solo decorador
- **`@Deprecated()`** — marca la ruta como obsoleta (tachado en Swagger UI)

#### Control de respuesta
- **`@HttpCode(statusCode)`** — sobreescribe el código HTTP de respuesta del handler (p.ej. `201` para creación). Usado también por el generador OpenAPI para el código de éxito documentado
- **`@ResponseSchema(schema, statusCode?)`** — valida y sanitiza la respuesta del handler con un esquema Zod; informa el modelo de respuesta al spec de OpenAPI

#### Middleware declarativo por ruta
- **`@Timeout(ms, message?)`** — aborta la petición con **408 Request Timeout** si el handler supera el límite. Inyecta automáticamente el middleware al inicio del pipeline y emite el header `X-Timeout-Ms`
- **`@RateLimit(options)`** — aplica rate-limiting a nivel de ruta individual usando la misma configuración de `createRateLimitMiddleware()`. Los headers estándar `X-RateLimit-*` se envían automáticamente

### 🛠️ Mejoras al Framework Core

#### OpenAPI Generator (`src/docs/openapi-generator.ts`)
- **Auto-tagging**: deriva tags automáticamente del primer segmento del path (`/products/:id` → tag `"Products"`) sin necesidad de anotarlos manualmente
- **Bearer security scheme**: añade `components.securitySchemes.bearerAuth` al spec y aplica `security: [{ bearerAuth: [] }]` en rutas protegidas de forma automática
- **401 automático**: rutas protegidas reciben una respuesta `401 Unauthorized` documentada sin configuración adicional
- **Soporte de `@HttpCode`**: usa el `statusCode` del decorador como clave del bloque de éxito en `responses`
- **`@ResponseSchema` en el spec**: cuando está presente, el esquema Zod se convierte al formato JSON Schema para el bloque de contenido de la respuesta

#### Sistema de Excepciones HTTP (`src/errors/exceptions.ts`)
Seis nuevas clases de excepción para cubrir casos de error comunes:
- `ConflictException` (409)
- `GoneException` (410)
- `PayloadTooLargeException` (413)
- `UnprocessableEntityException` (422)
- `TooManyRequestsException` (429)
- `ServiceUnavailableException` (503)

#### Logger estructurado en ErrorHandler (`src/errors/handler.ts`)
- Errores 5xx se registran con `getLogger().error` incluyendo path, método, status y stack
- Errores 4xx se registran como `warn` en entorno de desarrollo
- Errores genéricos no capturados también pasan por Pino

#### Arreglos de orden de decoradores
- **`@UseMiddleware`** (`src/decorators/middleware.ts`): ahora siempre llama a `MetadataRegistry.defineRoute` para que el middleware no se pierda independientemente del orden de ejecución de los decoradores
- **`@Cache` / `@CacheInvalidate`** (`src/decorators/cache.ts`): mismo patrón — los metadatos se fusionan correctamente sin importar el orden de apilamiento

#### MetadataCompiler — caché lazy con snapshots (`src/core/compiled-metadata.ts`)
- Compilación lazy: una ruta sólo se recompila si sus metadatos cambiaron (comparación por snapshot JSON)
- IDs únicos para handlers funcionales vía `WeakMap<Function, number>` — evita colisiones de caché cuando distintas instancias de app registran el mismo path con handlers diferentes (bug crítico en tests paralelos)
- Método `clearCache()` expuesto para limpiar el estado entre tests

### 🧪 TestClient — API fluida y helpers de autenticación (`src/testing/test-client.ts`)

Reescritura completa de `TestClient`:
- **`TestResponse`** — nueva clase de respuesta con propiedades `status`, `headers`, `body`, `text`, `ok` y métodos de aserción encadenables:
  - `expectStatus(code)`, `expectOk()`, `expectCreated()`, `expectNotFound()`, etc.
  - `expectJson(partialObject)` — comprobación parcial del body
  - `expectField(field, value?)` — verificar un campo específico
  - `expectHeader(name, value?)` — verificar un header de respuesta
  - `expectArrayLength(n)` — verificar longitud de array en respuesta
- **`withToken(token)`** — crea una instancia inmutable del cliente con el header `Authorization: Bearer` ya configurado
- **`withHeaders(headers)`** — crea una instancia inmutable con headers adicionales
- **`loginAs(credentials, endpoint?)`** — hace login, extrae el JWT y lo inyecta en el cliente actual para las peticiones siguientes
- **`registerAndLogin(user, endpoints?)`** — registra y hace login en una sola llamada
- **`clearAuth()`** — limpia el token almacenado

### 🔌 Plugins y Middleware

#### HealthCheckers.disk (`src/plugins/health.ts`)
- Usa `fs.statfs` (Node 18+ / Bun) para obtener métricas reales de disco: total, libre, usado y porcentaje
- Degradación elegante a `"healthy"` en plataformas sin soporte

#### CLI — Plantilla Fullstack corregida (`src/cli/commands/new.ts`)
- La plantilla `fullstack` ahora genera `src/index.ts` con `GraphQLPlugin` y `WebSocketPlugin` correctamente importados e instanciados (antes quedaban comentados)

#### Subpath exports en el build (`build.ts`)
- Se añadieron `./src/auth/index.ts`, `./src/adapters/base.ts`, `./src/adapters/hono.ts`, `./src/adapters/express.ts` como entrypoints explícitos para que los imports `veloce-ts/auth` y `veloce-ts/adapters/*` funcionen correctamente

### 🗄️ Drizzle ORM — Integración DI (`src/dependencies/drizzle.ts`)

Nuevo módulo para conectar Drizzle (u otro ORM) al contenedor de inyección de dependencias:
```typescript
// Registrar la instancia de la DB
registerDrizzle(app, db);

// Inyectar en controladores
@Get('/')
async list(@InjectDB() db: DrizzleDB) { … }
```
- `DB_TOKEN` — símbolo por defecto para el token de inyección
- `registerDrizzle(app, db, token?)` — registra como singleton en el `DIContainer`
- `@InjectDB(token?)` — decorador de parámetro, alias de `@Depends(DB_TOKEN)`

### 📊 Paginación mejorada (`src/orm/pagination.ts`)

#### Enriquecimiento de metadatos
- `PaginationMeta` incluye `from` y `to` (rango 1-based, p.ej. `from: 11, to: 20`)
- `CursorPaginatedResult` incluye `count` (ítems reales devueltos en la página)

#### Cursor pagination más precisa
- `createCursorPaginatedResult(data, limit, cursorField, hadPrevCursor)` — el nuevo parámetro `hadPrevCursor` activa `hasPrev: true` correctamente cuando se navega hacia adelante con cursor
- `createMultiCursor(entity, fields[])` — crea cursores compuestos por múltiples campos para ordenación estable (p.ej. `{ createdAt, id }`)
- `decodeMultiCursor(cursor)` — decodifica un cursor multi-campo de vuelta a un objeto

#### Helpers standalone
- `paginate<T>(data, total, page, limit)` — construye `{ data, meta }` en una sola llamada, sin necesidad de instanciar `PaginationHelper`
- `parseCursorQuery(query, defaultLimit?, maxLimit?)` — extrae `cursor` y `limit` de los query params sin lanzar excepciones
- `PaginationHelper.parsePaginationQuery(query, defaultLimit?, maxLimit?)` — equivalente para paginación offset; aplica límite máximo y usa defaults cuando los valores son inválidos

### 🔌 Express Adapter — Compatibilidad ESM (`src/adapters/express.ts`)

Reescritura completa del adaptador:
- Carga Express de forma lazy y segura usando `Function('return require')()` para compatibilidad ESM sin necesitar `declare const require: any`
- Acepta una instancia de Express pre-creada como segundo argumento del constructor (para añadir middleware propio antes del bridge)
- Manejo correcto de body raw (`Buffer`) vs body parseado (JSON/urlencoded)
- Omite el header `transfer-encoding` al reenviar respuestas (era fuente de errores en Express)
- Delega errores inesperados al pipeline de error de Express mediante `next(err)` en lugar de responder con 500 directamente

### 🐛 Bug Fixes

- **`ZodError` cross-module** (`src/errors/handler.ts`, `src/validation/validator.ts`): `instanceof ZodError` fallaba cuando la app consumidora tenía una instancia de Zod diferente a la del framework (caso frecuente con `bun link`). Añadido fallback `error.name === 'ZodError'` para garantizar respuestas 422 en todos los casos
- **Rutas `GET` marcadas públicas retornaban 401** en `products-api`: `app.use()` aplicaba el middleware a todos los métodos; corregido usando `app.on(['POST', 'PUT', 'DELETE'], path, middleware)` para restringir sólo a métodos de escritura
- **Cache collision en MetadataCompiler**: handlers funcionales distintos con el mismo path en diferentes instancias de app compartían el resultado compilado incorrecto; solucionado con IDs únicos por función
- **`@Cache` / `@UseMiddleware` perdían metadatos**: cuando se apilaban en orden inverso al de ejecución de decoradores, los metadatos podían sobreescribirse; solucionado actualizando el registro explícitamente en cada decorador

### 📋 Mensajes de validación mejorados (`src/validation/exceptions.ts`)

La respuesta de error `422` ahora incluye información estructurada adicional:
- `field` en formato convencional: `items[0].price` en lugar de `items.0.price`
- `received` — tipo recibido (cuando Zod lo reporta)
- `expected` — tipo esperado (cuando aplica)
- `minimum` / `maximum` — límites numéricos en errores de rango

```json
{
  "error": "Validation Error",
  "statusCode": 422,
  "details": [
    { "field": "email",        "message": "Invalid email",        "code": "invalid_string" },
    { "field": "age",          "message": "Number must be ≥ 18",  "code": "too_small", "minimum": 18 },
    { "field": "tags[1]",      "message": "String must not be empty", "code": "too_small" }
  ]
}
```

### 💥 Breaking Changes

Ninguno — todos los cambios son retrocompatibles. Las firmas de `createCursorPaginatedResult` tienen un nuevo parámetro opcional `hadPrevCursor` (cuarto argumento, `false` por defecto).

### 📦 Dependencias

Sin cambios en dependencias de runtime. Express sigue siendo peer dependency opcional.

---

## [0.3.3] - 2025-10-31

### 🐛 Critical Bug Fixes
- **JSON Response Serialization**: Fixed critical bug where JSON responses were not being serialized correctly
- **CLI Version Resolution**: Confirmed CLI correctly fetches and uses latest npm version (0.3.2)
- **Application Compilation**: Fixed missing `await app.compile()` call in generated templates

### 🔧 CLI Improvements
- **Version Fetching**: CLI now correctly fetches latest version from npm registry
- **Template Generation**: All templates now include proper `await app.compile()` call
- **Error Handling**: Improved error handling in CLI operations

## [0.3.2] - 2025-10-31

## [0.3.1] - 2025-10-31

### 🛠️ CLI Improvements

#### Enhanced Project Generation
- **Latest Version Fetching**: CLI now automatically fetches the latest VeloceTS version from npm registry
- **Improved Error Handling**: Better error messages and cleanup on project creation failure
- **Type Safety**: Fixed TypeScript errors in CLI with proper type definitions for npm registry API
- **Better User Experience**: Enhanced progress messages and visual feedback during project creation
- **Robust Fallbacks**: Multiple fallback strategies for version detection when npm is unavailable

#### Fixed Issues
- **npm Registry Integration**: Fixed CLI to use correct npm registry endpoint (`/veloce-ts` instead of `/veloce-ts/latest`)
- **Type Definitions**: Added proper TypeScript interfaces for npm registry response structure
- **Version Resolution**: Improved version parsing with proper type checking and validation
- **Package.json Generation**: Now uses specific dependency versions instead of 'latest' for better stability
- **Template Compilation**: All generated templates now include mandatory `await app.compile()` call

#### Technical Improvements
- **NpmRegistryResponse Interface**: Added proper typing for npm registry API responses
- **Async Error Handling**: Better error handling in async CLI operations
- **Dependency Versions**: Updated to use specific versions for better reproducibility:
  - `hono: ^4.0.0` (instead of 'latest')
  - `reflect-metadata: ^0.2.0` (instead of 'latest')
  - `zod: ^3.22.0` (instead of 'latest')
  - `typescript: ^5.3.0` (instead of 'latest')
- **Engine Requirements**: Added Node.js and Bun version requirements to generated package.json

#### Developer Experience
- **Progress Indicators**: Added emoji-based progress indicators for better visual feedback
- **Cleanup on Failure**: Automatic cleanup of partial projects when creation fails
- **Validation**: Better project name validation and error messages
- **Documentation**: Generated projects include comprehensive setup instructions

### 🐛 Bug Fixes
- **CLI TypeScript Errors**: Fixed 'data is of type unknown' error in npm registry API calls
- **Template Generation**: Fixed missing `await app.compile()` in all CLI templates
- **Dependency Management**: Improved dependency version resolution and fallback handling

### 📦 Migration Guide

#### For CLI Users
No breaking changes. Existing projects will continue to work. New projects generated with `veloce-ts new` will:
- Use the latest VeloceTS version automatically
- Include proper `await app.compile()` calls
- Have more stable dependency versions

#### For Framework Users
No changes required. This release only improves the CLI experience.

## [0.3.0] - 2025-10-29

### 🚀 Major Features Added

#### Response Caching System
- **In-Memory Cache Store**: Fast LRU-based caching with automatic cleanup
- **Redis Cache Store**: Distributed caching support for multi-instance deployments
- **@Cache() Decorator**: Declarative response caching with flexible TTL configuration
- **@CacheInvalidate() Decorator**: Pattern-based cache invalidation for mutations
- **Cache Middleware**: Functional API support for route-level caching
- **TTL Support**: Flexible time-to-live with string format ('5m', '1h', '1d') or seconds
- **Pattern Invalidation**: Wildcard pattern matching for cache invalidation ('products:*')
- **Cache Keys**: Smart key generation with placeholder support ('product:{id}')
- **Cache Headers**: Automatic X-Cache headers (HIT/MISS) in responses

#### Enhanced Request Context
- **Automatic Request IDs**: UUID generation for every request
- **@RequestId() Decorator**: Inject request ID into controller methods
- **@AbortSignal() Decorator**: Request cancellation support for long-running operations
- **Request Timeouts**: Configurable timeouts per route or globally
- **Logging Integration**: Request ID automatically propagates through all logs
- **Response Headers**: X-Request-ID header in all responses
- **Metadata Storage**: Attach custom data to request context
- **Request Lifecycle**: Automatic logging of request start/end with duration

#### Logging Improvements
- **Request Context Integration**: Automatic request ID in all log entries
- **Child Loggers**: Enhanced contextual logging with inheritance
- **Structured Logging**: JSON-formatted logs for production
- **Pretty Printing**: Human-readable logs for development
- **Log Middleware**: Request lifecycle logging with configurable headers

### 🎯 New Decorators

- **@Cache(options)**: Cache route responses with TTL and key configuration
- **@CacheInvalidate(pattern)**: Invalidate cache entries matching patterns
- **@RequestId()**: Inject unique request ID into handler parameters
- **@AbortSignal()**: Inject AbortSignal for request cancellation

### 🔧 New Middleware

- **createRequestContextMiddleware()**: Initialize request context with ID, timeout, and logging
- **createSimpleRequestIdMiddleware()**: Minimal request ID middleware
- **createCacheMiddleware()**: Functional API route caching
- **createCacheInvalidationMiddleware()**: Functional API cache invalidation

### 📦 New Modules

- **src/cache/**: Complete caching system
  - `types.ts`: Cache interfaces and types
  - `memory-store.ts`: In-memory LRU cache implementation
  - `redis-store.ts`: Redis backend for distributed caching
  - `manager.ts`: Global cache management and utilities
- **src/context/**: Enhanced request context
  - `request-context.ts`: Request tracking with UUID and AbortSignal
- **src/middleware/**: New middleware
  - `request-context.ts`: Request context initialization
  - `cache.ts`: Cache middleware for functional API
- **src/decorators/**: New decorators
  - `cache.ts`: @Cache and @CacheInvalidate decorators

### 🛠️ Core Improvements

- **Router Compiler**: Integrated cache checking and invalidation in route handlers
- **Type System**: New parameter types for request-id and abort-signal
- **Export System**: All new decorators and middleware properly exported
- **Error Handling**: Improved error handling with request ID context

### 📚 Documentation

#### New Guides (English + Spanish)
- **Caching Guide**: Complete guide to response caching (15,000 words total)
  - In-memory and Redis stores
  - Decorators and middleware
  - TTL configuration
  - Cache invalidation strategies
  - Best practices with 50+ code examples
- **Request Context Guide**: Request tracking and management (12,000 words total)
  - Automatic UUID generation
  - Request cancellation with AbortSignal
  - Timeout configuration
  - Logging integration
  - 40+ code examples
- **Logging Guide**: Structured logging with Pino (4,000 words total)
  - Logger configuration
  - Child loggers
  - Request ID integration
  - Best practices

#### Documentation Coverage
- Added 31,000+ words of professional documentation
- 100+ new code examples
- Bilingual support (English and Spanish)
- SEO-optimized with meta descriptions
- Cross-referenced between guides

### 🌐 Sidebar Updates

Updated Starlight documentation sidebar with new guides:
- Caching
- Request Context
- Logging

### ⚡ Performance Improvements

- **Cache System**: Sub-millisecond cache hits with in-memory store
- **LRU Eviction**: Automatic memory management in cache store
- **Request Context**: Minimal overhead UUID generation
- **Logging**: Efficient structured logging with Pino

### 🔄 API Additions

#### Cache Manager
```typescript
- CacheManager.setDefaultStore(store)
- CacheManager.getDefaultStore()
- CacheManager.generateKey(method, path, params, query, options)
- CacheManager.get(key, store?)
- CacheManager.set(key, value, ttl?, store?)
- CacheManager.delete(key, store?)
- CacheManager.invalidate(pattern, store?)
- CacheManager.clear(store?)
```

#### Helper Functions
```typescript
- getCache<T>(key): Promise<T | null>
- setCache<T>(key, value, ttl?): Promise<void>
- deleteCache(key): Promise<boolean>
- invalidateCache(pattern): Promise<number>
- clearCache(): Promise<void>
- getRequestId(context): string | null
- getAbortSignal(context): AbortSignal | null
- setRequestMetadata(context, key, value): void
- getRequestMetadata(context, key): any
- generateRequestId(): string
```

### 🐛 Bug Fixes

- **ORM Exports**: Fixed DrizzleTransactionManager import path
- **Middleware Exports**: Added missing createCacheInvalidationMiddleware export
- **Request Context**: Fixed AbortController reference in context

### 💥 Breaking Changes

None - All changes are additive and backward compatible

### 📦 Dependencies

No new runtime dependencies added. Caching works with existing dependencies:
- In-memory cache: No dependencies (built-in)
- Redis cache: Requires `redis` or `ioredis` (peer dependency)

### 🎯 Migration Guide

#### Adding Cache to Existing Routes

```typescript
// Before
@Get('/products')
async getProducts() {
  return await db.products.findAll();
}

// After - Add caching
@Get('/products')
@Cache({ ttl: '5m', key: 'products:list' })
async getProducts() {
  return await db.products.findAll();
}
```

#### Adding Request Tracking

```typescript
// Add to app initialization
import { createRequestContextMiddleware } from 'veloce-ts';

app.use(createRequestContextMiddleware({
  timeout: 30000,
  logging: true
}));

// Use in controllers
@Get('/data')
async getData(@RequestId() requestId: string) {
  logger.info({ requestId }, 'Processing request');
  return data;
}
```

### 📊 Statistics

- **New Files**: 15+ new source files
- **Documentation**: 31,000+ words
- **Code Examples**: 100+ examples
- **Test Coverage**: All new features covered
- **Languages**: Full bilingual support (EN/ES)

### 🙏 Acknowledgments

This release brings powerful performance optimization features to Veloce-TS:
- Response caching reduces database load and improves response times
- Request tracking enables better debugging and monitoring
- Enhanced logging provides better observability in production

## [0.2.6] - 2025-10-15

### Fixed
- **Query Export**: Added missing `Query` export from main index to resolve import conflicts
- **Parameter Decorators**: HTTP `@Query` decorator now properly exported alongside GraphQL decorators
- **Import Resolution**: Fixed "Export named 'Query' not found" error in applications

## [0.2.5] - 2025-10-15

### Fixed
- **GraphQL Query Conflict**: Removed conflicting alias `Query` from GraphQL decorators
- **Import Resolution**: GraphQL decorators now use `GQLQuery` to avoid conflicts with HTTP `@Query` decorator
- **Type Safety**: Eliminated TypeScript errors caused by decorator name conflicts

### Breaking Changes
- GraphQL queries now use `@GQLQuery` instead of `@Query` to avoid conflicts with HTTP parameter decorator

## [0.2.4] - 2025-10-15

### Fixed
- **Query Decorator**: Fixed `@Query` decorator to properly handle parameters without schemas
- **Query Parameter Extraction**: Improved query parameter handling in router compiler
- **Validation**: Added proper validation for query parameters with optional Zod schemas
- **Error Handling**: Fixed missing `ValidationError` import, now using `BadRequestException`

### Improved
- **Query Decorator Flexibility**: `@Query` now supports multiple usage patterns:
  - `@Query()` - Extract all query parameters
  - `@Query('param')` - Extract specific parameter
  - `@Query(Schema)` - Validate with Zod schema
- **Router Compiler**: Enhanced parameter extraction and validation logic
- **Type Safety**: Better TypeScript support for query parameter handling

### Breaking Changes
- None

## [0.2.3] - 2025-10-14

### Fixed
- **WebSocket Exports**: Fixed missing `WebSocket` decorator export from WebSocket module
- **Import Resolution**: WebSocket decorators now properly exported from `veloce-ts/websocket`

## [0.2.2] - 2025-10-14

### Fixed
- **GraphQL Decorators**: Added missing `Query`, `Mutation`, and `Subscription` aliases for GraphQL decorators
- **Import Conflicts**: Fixed naming conflicts between params and GraphQL decorators
- **CLI Templates**: Fixed import errors in CLI template generation
- **Package Version**: CLI now uses current package version when generating new projects

### Changed
- **GraphQL Exports**: GraphQL decorators now available with intuitive names (`Query`, `Mutation`, `Subscription`)
- **Import Resolution**: Cleaner import structure to avoid naming conflicts

## [0.2.1] - 2025-10-14

### Fixed
- **GraphQL Exports**: Fixed missing `Arg` decorator export from GraphQL module
- **Import Resolution**: GraphQL decorators now properly exported from `veloce-ts/graphql`
- **Type Definitions**: GraphQL decorators included in TypeScript declarations

## [0.2.0] - 2025-10-14

### 🚀 Major Features Added
- **Complete Authentication System**: JWT-based authentication with access/refresh tokens
- **Role-Based Access Control (RBAC)**: Hierarchical roles with granular permissions system
- **SQLite Integration**: Built-in SQLite support with Bun's native database
- **Real-time WebSocket Support**: Enhanced WebSocket handling with decorators
- **GraphQL Integration**: Complete GraphQL support with resolvers and subscriptions
- **Advanced Middleware System**: Custom middleware with request/response interceptors
- **Admin Panel Features**: Comprehensive admin endpoints for user and system management

### 🎯 New Decorators & Features
- **@Auth**: JWT authentication decorator with automatic user injection
- **@CurrentUser**: Inject current authenticated user into handlers
- **@MinimumRole**: Role-based endpoint protection
- **@Permissions**: Granular permission-based access control
- **@WebSocket**: Enhanced WebSocket decorators with connection management
- **@Resolver**: GraphQL resolver decorators for queries and mutations
- **@OnConnect/@OnMessage/@OnDisconnect**: WebSocket lifecycle decorators

### 🔧 Core Framework Improvements
- **Router Compiler Fixes**: Fixed critical bugs with sparse array handling in metadata
- **Dependency Injection**: Enhanced DI system with better error handling
- **Parameter Resolution**: Improved parameter and dependency resolution
- **Type Safety**: Enhanced TypeScript inference and type checking
- **Error Handling**: Better error messages and debugging capabilities

### 📚 Documentation & Examples
- **Veloce TaskMaster**: Complete real-world example with authentication, RBAC, and frontend
- **Comprehensive Examples**: Task management system showcasing all framework features
- **Migration Guides**: Documentation for migrating from Express.js and other frameworks
- **API Documentation**: Enhanced OpenAPI/Swagger documentation generation

### 🛠️ Technical Improvements
- **Performance**: Optimized router compilation and metadata handling
- **Memory Management**: Better handling of metadata arrays and object references
- **Bundle Size**: Reduced framework bundle size through optimizations
- **Build System**: Improved TypeScript compilation and type generation
- **Testing**: Enhanced testing utilities and error reporting

### 🔒 Security Enhancements
- **JWT Security**: Secure token generation and validation
- **Password Hashing**: Built-in password hashing utilities
- **CSRF Protection**: Enhanced CORS and security middleware
- **Input Validation**: Improved Zod schema validation
- **Role Hierarchy**: Configurable role hierarchy with permission inheritance

### 🎨 Developer Experience
- **Better Error Messages**: More descriptive error messages with stack traces
- **Hot Reload**: Improved development server with better file watching
- **TypeScript Support**: Enhanced type inference and IntelliSense
- **Debugging**: Better debugging capabilities with request tracing
- **CLI Improvements**: Enhanced CLI with better project scaffolding

### 🐛 Critical Bug Fixes
- **Router Compilation**: Fixed sparse array handling in parameter metadata
- **Dependency Resolution**: Fixed undefined dependency handling
- **Array Length Errors**: Fixed array creation with invalid indices
- **Import Path Issues**: Corrected all import paths in generated projects
- **Metadata Processing**: Fixed metadata compilation edge cases

### 📦 New Dependencies
- **jsonwebtoken**: JWT token generation and validation
- **reflect-metadata**: Enhanced reflection capabilities for decorators
- **zod-to-json-schema**: Improved OpenAPI schema generation

## [0.1.7] - 2025-10-12

### Fixed
- Fixed syntax error in CLI new command that prevented build from completing
- Fixed README generation in CLI templates

## [0.1.6] - 2025-10-12

### Added
- **Landing Page**: Created modern Astro-based website with interactive terminal and file explorer
- **Interactive Terminal**: Built terminal component for API testing with command history
- **File Explorer**: Developed code browser with hierarchical navigation for demo app
- **Documentation Files**: CLI now generates README.md and API_DOCUMENTATION.md in new projects

### Changed
- **Complete Rebranding**: Renamed framework from FastAPI-TS to Veloce-TS throughout codebase
- **OpenAPIPlugin**: Now serves Swagger UI directly from code (no need for static HTML files)
- **Improved Swagger UI**: Updated to version 5.9.0 with better styling and functionality
- **Simplified Templates**: `veloce-ts new` command no longer generates unnecessary public files
- **Better Defaults**: OpenAPI documentation now uses "Veloce-TS" branding by default
- **Updated URLs**: All references now point to correct GitHub repository and documentation

### Fixed
- Fixed Swagger UI rendering issues with proper script loading
- Fixed OpenAPI plugin to correctly serve HTML responses and return proper content types
- Fixed broken links and outdated branding throughout codebase
- Improved CORS handling in generated templates
- Fixed CLI template generation to include proper documentation structure

## [0.1.5] - 2025-10-12

### Fixed
- Fixed CLI templates to include OpenAPIPlugin automatically when docs: true
- REST and Fullstack templates now properly initialize OpenAPI documentation

## [0.1.4] - 2025-10-13

### Fixed
- Fixed CLI templates to call `await app.compile()` before `app.listen()`
- This fixes the 404 error on all routes in generated projects

## [0.1.3] - 2025-10-12

### Fixed
- Fixed package.json main and exports paths to point to correct dist/*/src/ directories
- This fixes the "Cannot find package" error when importing veloce-ts

## [0.1.2] - 2025-10-12

### Fixed
- Fixed CLI templates to use correct package name `veloce-ts` instead of `VeloceTS`
- Fixed all import statements in generated projects

## [0.1.1] - 2025-10-12

### Fixed
- Fixed CLI binary path to use compiled dist files instead of source files

## [0.1.0] - 2025-10-12

### Added
- Initial release of veloce-ts framework
- Decorator-based routing with @Controller, @Get, @Post, @Put, @Delete, @Patch
- Functional API for decorator-free routing
- Automatic request validation with Zod schemas
- Dependency injection system with singleton, request, and transient scopes
- Automatic OpenAPI documentation generation
- Response handling with JSONResponse, HTMLResponse, FileResponse, StreamResponse, RedirectResponse
- Plugin system for extensibility
- WebSocket support with decorators
- GraphQL support with decorators
- CLI tool for project scaffolding and development
- Middleware system with CORS, rate limiting, and compression
- Error handling with custom exceptions
- Testing utilities with TestClient
- Multi-runtime support (Bun, Node.js, Deno, Cloudflare Workers)
- Adapter system for Express and Hono
- Type safety with full TypeScript support
- Performance optimizations with metadata compilation and schema caching

[Unreleased]: https://github.com/ExcessHawk/veloce-ts/compare/v3.2.0...HEAD
[3.2.0]: https://github.com/ExcessHawk/veloce-ts/compare/v3.1.2...v3.2.0
[3.1.2]: https://github.com/ExcessHawk/veloce-ts/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/ExcessHawk/veloce-ts/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/ExcessHawk/veloce-ts/compare/v3.0.1...v3.1.0
[3.0.1]: https://github.com/ExcessHawk/veloce-ts/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/ExcessHawk/veloce-ts/compare/v2.0.2...v3.0.0
[2.0.2]: https://github.com/ExcessHawk/veloce-ts/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/ExcessHawk/veloce-ts/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/ExcessHawk/veloce-ts/compare/v1.2.0...v2.0.0
[1.0.0]: https://github.com/ExcessHawk/veloce-ts/compare/v0.4.18...v1.0.0
[0.4.18]: https://github.com/ExcessHawk/veloce-ts/compare/v0.4.10...v0.4.18
[0.4.10]: https://github.com/ExcessHawk/veloce-ts/compare/v0.4.9...v0.4.10
[0.4.0]: https://github.com/ExcessHawk/veloce-ts/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/ExcessHawk/veloce-ts/releases/tag/v0.3.3
[0.3.2]: https://github.com/ExcessHawk/veloce-ts/releases/tag/v0.3.2
[0.3.1]: https://github.com/ExcessHawk/veloce-ts/compare/v0.3.0...v0.3.1
[0.2.2]: https://github.com/ExcessHawk/veloce-ts/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ExcessHawk/veloce-ts/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.7...v0.2.0
[0.1.7]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ExcessHawk/veloce-ts/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ExcessHawk/veloce-ts/releases/tag/v0.1.0
