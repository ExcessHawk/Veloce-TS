# Veloce-TS Improvement Plan (v1.2.0 → top-tier)

Audit date: 2026-07-11. Full codebase review: core internals, feature modules, tooling/CI.
Goal: make Veloce-TS a top-tier framework. Priorities: P0 = correctness/security, P1 = type safety, P2 = performance, P3 = quality infrastructure, P4 = feature completion & polish.

Status legend: [ ] pending · [x] done · [~] in progress

---

## P0 — Correctness & security (fix before any new feature)

- [x] **P0-1 JWT token-type confusion (SECURITY).** `verifyAccessToken()` never rejects `payload.type === 'refresh'` (`src/auth/jwt-provider.ts:86-105`), while `verifyRefreshToken` does check (`:126`). With `refreshSecret` defaulting to `secret` (`:70`, `:118`), a long-lived refresh token (7d default) passes as an access token. Add the type check mirroring `:126`.
- [x] **P0-2 GraphQL execution broken.** `buildSchema(typeDefs)` + nested `{Query:{...}}` as `rootValue` (`src/graphql/plugin.ts:230-239`) — graphql-js looks up root fields on `rootValue.<field>`, so resolvers are never invoked. Also every field's return type is hardcoded `'String'` (`src/graphql/schema-builder.ts:124-127`) and `customTypes` is never populated (`:14`, `:57-59`) — the working converters in `zod-to-graphql.ts:130,154` are dead code. Fix the wiring + wire the converters, or mark the module experimental in README until done.
- [x] **P0-3 Response schema failures swallowed.** `@ResponseSchema` parse errors are silently ignored (`src/core/router-compiler.ts:247-252`). Should 500 (or log loudly) — silent pass-through defeats the feature.
- [x] **P0-4 Query params validated twice with inconsistent errors.** `param.schema.parse` in the `'query'` branch (`router-compiler.ts:366-372`) then again via `validator.validate` (`:513-519`); first throws `BadRequestException` with stringified error, second a proper `ValidationException`. Keep one path.
- [x] **P0-5 Redis cache uses blocking `KEYS`.** `clear()`/`deletePattern()` (`src/cache/redis-store.ts:72-97`) — replace with `SCAN` cursor + pipelined `DEL`/`UNLINK`.
- [x] **P0-6 Rate-limit key trusts `x-forwarded-for`** by default (`src/middleware/rate-limit.ts:19-26`) — spoofable. Add a `trustProxy` option, default off, document it.
- [x] **P0-7 RS256/384/512 unusable.** `JWTConfig.algorithm` offers them but signing always uses `config.secret` (`jwt-provider.ts:55-57`). Add `privateKey`/`publicKey` config fields.
- [x] **P0-8 "LRU" cache is FIFO.** Eviction uses `entry.createdAt` (`src/cache/memory-store.ts:149-162`); reads never update recency. Make it true LRU (touch on get) or rename honestly.
- [x] **P0-9 `Response.file()` Bun-only.** `readFileNode` just throws (`src/responses/response.ts:256-260`). Implement with `node:fs` streams.
- [x] **P0-10 Double graceful-shutdown registration.** Two SIGTERM/SIGINT registrations with competing timeouts and `process.exit(0)` (`src/core/application.ts:567-580` and `:702-725`). Consolidate into one.
- [x] **P0-11 Event bus error isolation.** Async `emit` uses `Promise.all` (`src/events/event-bus.ts:31-43`) — one throwing listener aborts the rest. Use `allSettled` + report errors.
- [x] **P0-12 Distributed token revocation.** JWT blacklist and `MemorySessionStore` are in-memory only — logout doesn't propagate across instances. Add a Redis-backed blacklist (Redis session store already exists as a pattern, `src/auth/session.ts:107`).

## P1 — End-to-end type safety (the differentiator)

Stage-2 decorators stay (settled decision). Parameter decorators can't rewrite parameter types, so invest where inference IS possible:

- [x] **P1-1 Fully typed functional API.** `RouteConfig.handler` is `(c, ...args: any[]) => any` and `schema` holds bare `ZodSchema` (`src/types/index.ts:145-151`). Make `route()` generic over the schema bag so handler args infer from Zod — Hono/Elysia-level inference as the typed alternative on the same core. `TypedHandler` (`types/index.ts:390-400`) exists but is unused; wire or replace it.
- [x] **P1-2 Purge `any` from the public surface.** `plugins?: any[]`, `CacheMetadata.store?: any` (`types/index.ts:113,65`), `ParameterMetadata.metadata?: any` (`:74`), the whole auth/OAuth/roles metadata path (`src/core/metadata.ts:531-707`), adapter `listen`/`getHandler` returns (`src/adapters/express.ts:67-77`).
- [x] **P1-3 Typed generated client.** CLI client generator emits `Promise<any>` everywhere (`src/cli/commands/generate.ts:522-636`). Derive types from the real OpenAPI generator + Zod schemas.
- [x] **P1-4 Publish-time type verification.** Run `publint` + `@arethetypeswrong/cli` in CI; `test:package` currently only checks `dist/types` exists (`scripts/test-package.ts:24-39`).

## P2 — Performance (the name says "fast" — make the hot path prove it)

- [x] **P2-1 Use or delete the compiled-metadata layer.** `MetadataCompiler` precomputes `pathRegex`, `parameterOrder`, `dependencyOrder`, `has*` flags (`src/core/compiled-metadata.ts:63-140`) but the runtime handler never reads them; only `maxArgumentIndex` is used. Wire the precomputation into the handler (real win) or delete the dead layer.
- [x] **P2-2 Move reflection out of the request path.** `getInterceptors` does 2 `Reflect.getMetadata` reads per request (`router-compiler.ts:184`, `interceptor-manager.ts:25-32`); controller resolution is `transient` per request and re-reads ctor-dep metadata (`router-compiler.ts:195-198`, `dependencies/container.ts:185`). Resolve both once at `compile()` and cache; add controller scope option (singleton default is the classic answer).
- [x] **P2-3 Hoist hot-path dynamic imports.** `await import()` for cache manager, request-context, auth exceptions inside handlers (`router-compiler.ts:146-147,210,220,443,498,504`). Import once at compile time.
- [x] **P2-4 Trim per-request allocations.** `mergeArguments` recomputes `Math.max(...indices)` despite precomputed `maxArgumentIndex` (`router-compiler.ts:535-576`); interceptor chain rebuilds arrays per request (`interceptor-manager.ts:46`).
- [x] **P2-5 Honest, current benchmarks.** Results labeled v0.4.3 while framework is 1.2.0 (`benchmarks/run.ts:29`, `BENCHMARKS.md:104-115`); `results/latest.json` contradicts the "−19–37% vs Hono" narrative (shows parity); `internal-2026-06-26.txt` is empty; README claims Elysia comparison but no Elysia server exists. Unify `run.ts`/`run-all.ts`, add Elysia or drop the claim, re-run after P2-1..4, publish real numbers.

## P3 — Quality infrastructure

- [x] **P3-1 Test the 1.2.0 flagship features.** Zero test matches for `EventBus`, `useInterceptor`, `@SSE`/`@Stream`, `useFilter`/`@Catch`, `onShutdown`. Interceptors, streaming, exception filters, event bus, graceful shutdown — all untested.
- [x] **P3-2 Test the ORM layer.** 30 files (repos, query-builder, transactions, 3 adapters) covered only by `pagination.test.ts`. Also untested: `src/events/`, `src/adapters/`, `src/dependencies/`, `interceptor-manager.ts`, `exception-filter.ts`.
- [x] **P3-3 CI runtime matrix.** Only Bun runs in CI (`.github/workflows/ci.yml:16`) despite Node 18+/Deno claims. Add Node LTS + Deno legs, pin Bun version.
- [x] **P3-4 Make `.d.ts` failures fatal.** `build.ts:127-132` continues past type-generation errors even in `--production` — a release can ship broken types while CI is green.
- [x] **P3-5 Coverage gating.** Coverage job collects but never uploads or gates (`ci.yml:42-58`). Upload + set a floor.
- [x] **P3-6 CLI runs without Bun.** `bin/veloce.ts:2` is `#!/usr/bin/env bun` importing from `dist/cjs` — Node-only users can't run the CLI. Ship a compiled JS bin with node shebang.
- [x] **P3-7 `generate openapi` reuses the real generator.** CLI reimplements a minimal OpenAPI builder (`generate.ts:400-479`) that ignores Zod. Delegate to `src/docs/openapi-generator.ts`.

## P4 — Feature completion & polish

- [x] **P4-1 WebSocket hardening.** No heartbeat/ping-pong, idle timeout, or max-message-size/backpressure (`src/websocket/manager.ts`); `executeHandler` falls back to `new metadata.target()` bypassing DI (`manager.ts:156`); Node unsupported (`plugin.ts:20-29`) — consider `@hono/node-ws`.
- [x] **P4-2 OpenAPI polish.** Component names are `Schema1/Schema2` (`src/docs/zod-to-json-schema.ts:159-161`) — derive from schema/DTO names; module-global `schemaCounter`/`schemaCache` leak across generations (`:42-43`) — make per-instance. No `examples` plumbing; only `application/json` (no multipart/form for uploads). Swagger UI from unpkg without SRI (`src/plugins/openapi.ts:88-97`) — self-host or add SRI.
- [x] **P4-3 ORM base-repo footguns.** `count()` loads all rows, `updateMany`/`deleteMany` fetch-then-loop (`src/orm/base-repository.ts:106-133,167-170`). Throw `NotImplemented` unless the adapter overrides, instead of silently scanning.
- [x] **P4-4 Plugin lifecycle hooks.** Plugin contract is install-only (`src/core/plugin.ts:12-27`) — no `onStart`/`onStop`/`uninstall`, so plugins can't tear down resources. Add lifecycle to the interface; PluginManager's topo-sort already handles ordering.
- [x] **P4-5 Real Cloudflare adapter.** `listen()` throws on workerd (`src/adapters/hono.ts:66-69`); no `adapter: 'cloudflare'` mapping (`application.ts:741-765`). Add a fetch-export helper + docs.
- [x] **P4-6 Express adapter streaming.** Responses buffered via `arrayBuffer()` (`src/adapters/express.ts:202`), killing SSE/streaming; JSON round-trip at `:194-196`.
- [x] **P4-7 Logging `pretty` no-op.** `LoggerConfig.pretty` accepted but never wired to a pino-pretty transport (`src/logging/logger.ts:37-39,187`).
- [x] **P4-8 Refactor `MetadataRegistry`.** ~500 lines of near-identical `defineX/getX/hasX` triplets (`src/core/metadata.ts`) → one generic helper. Deduped the two timeout middlewares into `src/middleware/timeout.ts`. Splitting `application.ts` deliberately skipped: high churn, no behavioural or DX payoff.
- [x] **P4-9 Docs & repo hygiene.** README says "Pre-1.0 — APIs may change" at v1.2.0 (`README.md:554`); roadmap lists shipped CLI scaffolding as planned (`:562`); broken `CONTRIBUTORS.md` link (`:617`); duplicate `[0.1.0]` CHANGELOG entries (lines 895, 917); committed SQLite artifacts in examples (`chat.db*`, `products.db`, `todos.db`) — remove + gitignore.

---

## Suggested order

1. **P0-1 alone, patch release immediately** (security).
2. Rest of P0 → patch/minor.
3. P3-3/P3-4/P3-5 (CI trust) before P1/P2 so regressions get caught.
4. P1 (typed functional API) — biggest marketable differentiator.
5. P2 + fresh benchmarks — publish numbers with the perf wins.
6. P3-1/P3-2 tests alongside each P1/P2 change.
7. P4 as ongoing polish; P0-2 GraphQL decision (fix vs experimental flag) early because README advertises it.
