# Migration Guide

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
