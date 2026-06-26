# Contributing to veloce-ts

## Development Setup

```bash
git clone https://github.com/ExcessHawk/veloce-ts.git
cd veloce-ts
bun install
bun test          # 413 tests, 0 failures
bun run build     # ESM + CJS + type declarations
```

**Requirements:** Bun >= 1.0.0, TypeScript >= 5.0.

---

## Repository Layout

```
src/
  core/            # Application bootstrap, router compiler, metadata registry
  auth/            # JWT, RBAC, OAuth, sessions, permissions plugins
  cache/           # CacheManager, MemoryCacheStore, RedisCacheStore
  decorators/      # @Controller, @Get, @Body, @Cache, @Timeout, etc.
  dependencies/    # DIContainer, registerDrizzle/Prisma/TypeORM helpers
  errors/          # HTTP exceptions, error handler, RFC 9457 formatter
  graphql/         # GraphQLPlugin (accepts pre-built schema)
  middleware/       # CORS, rate-limit, compression, request-context
  orm/             # BaseRepository, Drizzle/TypeORM/Prisma adapters
  plugins/         # PluginManager, HealthCheckPlugin, OpenAPIPlugin
  responses/       # JSONResponse, HTMLResponse, RedirectResponse, etc.
  validation/      # ValidationEngine wrapping Zod
  websocket/       # WebSocketPlugin, WebSocketManager (Bun/Deno only)
  testing/         # TestClient helper

tests/             # Unit / integration tests (bun test)
examples/          # Working example apps (chat-api, todos-api, products-api)
benchmarks/        # HTTP throughput (run.ts) + internal micro-benchmarks
```

Key constraint: `drizzle-orm`, `typeorm`, `prisma`, `graphql`, `ioredis` are **optional peer deps** — never import them at module top level. Use lazy `require()` inside a getter function.

---

## Making Changes

### Branch naming

```
feat/short-description
fix/short-description
docs/short-description
test/short-description
```

### Workflow

```bash
git checkout -b feat/my-feature

# Make changes in src/
bun run build          # rebuild dist/ so examples and tests pick up changes
bun test               # must stay at 0 failures
bun run typecheck      # must stay at 0 errors
```

### Commit messages — Conventional Commits

```
feat: add @Timeout decorator with configurable message
fix: MetadataCompiler cache key collision across test files
docs: add migration guide for 0.x → 1.0
test: cover PermissionPlugin grant/revoke routes
perf: replace Set blacklist with Map for O(1) expiry lookup
chore: bump hono to 4.12.16
```

One subject line, imperative mood, ≤ 72 chars. Add a body if the _why_ is non-obvious.

---

## Writing Tests

Tests live in `tests/`. Each file is self-contained — no shared state between files (Bun runs all files in the same process).

**Pattern for decorator-based routes:**

```typescript
import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'bun:test';
import { Veloce, Controller, Get, Param } from 'veloce-ts';
import { CacheManager } from 'veloce-ts';

let hono: ReturnType<typeof app.getHono>;

beforeAll(async () => {
  CacheManager.reset(); // isolate from other test files
  @Controller('/items')
  class ItemController {
    @Get('/:id')
    get(@Param('id') id: string) { return { id }; }
  }
  const app = new Veloce({ docs: false });
  app.include(ItemController);
  await app.compile();
  hono = app.getHono();
});

it('returns item', async () => {
  const res = await hono.fetch(new Request('http://localhost/items/42'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toBe('42');
});
```

Rules:
- Always call `CacheManager.reset()` in `beforeAll` for tests that register controllers — prevents cache collision with other files running in the same Bun process.
- Use unique controller class names or wrap in `beforeAll` scope to avoid `reflect-metadata` key collision.
- No network calls, no real databases in `tests/`. Mock at the service boundary.
- Example apps in `examples/*/tests/` are integration tests — they spin up real in-process apps.

---

## Adding a New Plugin

1. Create `src/plugins/my-plugin.ts` implementing the `Plugin` interface:

```typescript
import type { VeloceTS } from '../core/application';

export class MyPlugin {
  readonly name = 'my-plugin';
  readonly version = '1.0.0';

  constructor(private config: MyPluginConfig) {}

  async install(app: VeloceTS): Promise<void> {
    const hono = app.getHono();
    hono.get('/my-route', (c) => c.json({ ok: true }));
  }
}
```

2. Export from `src/plugins/index.ts` and `src/index.ts`.
3. Add at least one test in `tests/plugins.test.ts` or a dedicated file.
4. Document in README under "Plugin System".

---

## Adding a New Decorator

1. Define the decorator in `src/decorators/` or the relevant subdirectory.
2. Store metadata using `MetadataRegistry` — never raw `Reflect.defineMetadata` keys outside the registry.
3. Read it back in `RouterCompiler` or wherever dispatch happens.
4. Export from `src/decorators/index.ts` and `src/index.ts`.
5. Add a test that verifies the metadata is stored AND that dispatch produces the expected HTTP behavior.

---

## Testing Locally in a Project

```bash
# In this repo
bun link

# In your test project
bun link veloce-ts
```

After any source change, rebuild before testing:

```bash
bun run build && bun link
```

---

## PR Checklist

Before opening a pull request:

- [ ] `bun test` — 0 failures
- [ ] `bun run typecheck` — 0 errors
- [ ] `bun run build` — builds without warnings
- [ ] New feature has at least one test
- [ ] Breaking change has an entry in `CHANGELOG.md` under `[Unreleased]` and a migration note in `MIGRATION.md`
- [ ] Public API additions are exported from `src/index.ts`
- [ ] Optional peer dep usage goes through lazy `require()`, not static `import`

---

## Release Process (maintainers)

```bash
# 1. Verify everything passes
bun test
bun run typecheck

# 2. Bump version (choose one)
bun run release:patch   # x.y.Z
bun run release:minor   # x.Y.0
bun run release:major   # X.0.0

# 3. Move [Unreleased] entries to the new version in CHANGELOG.md
# 4. Build production bundle
bun run build:prod

# 5. Publish
npm publish

# 6. Tag and push
git tag vX.Y.Z
git push && git push --tags
```

---

## Questions

Open an issue on [GitHub](https://github.com/ExcessHawk/veloce-ts/issues) or start a [Discussion](https://github.com/ExcessHawk/veloce-ts/discussions).
