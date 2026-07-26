# Veloce-TS Benchmarks

---

## Internal Micro-Benchmarks — v1.2.0

In-process measurements of framework internals. No network, no TCP — pure dispatch overhead.

_Run: 2026-07-26 · Bun 1.3.14 · Windows 11 · `bun benchmarks/internal.bench.ts`_

The "v0.4.18" column is the previous published run, kept so the effect of the
performance pass in this release is visible rather than quietly overwritten.

| Operation | Throughput | Latency | vs v0.4.18 |
|---|---:|---:|---:|
| **JWT** | | | |
| `generateTokens()` | 32,329 ops/s | 30.9 µs | +2% |
| `verifyAccessToken()` | 51,137 ops/s | 19.6 µs | +13% |
| `decodeToken()` | 251,377 ops/s | 4.0 µs | +12% |
| `isBlacklisted()` | 18,135,490 ops/s | 0.055 µs | now async — see note |
| **MetadataCompiler** | | | |
| `compile()` — cache miss | 887,713 ops/s | 1.13 µs | +204% |
| `compile()` — cache hit | 1,876,500 ops/s | 0.53 µs | +20% |
| `compileAll()` | 1,782,658 ops/s | 0.56 µs | n/a |
| **MetadataRegistry** | | | |
| `getRouteMethods()` | 2,929,050 ops/s | 0.34 µs | n/a |
| `getRouteMetadata()` | 13,760,761 ops/s | 0.073 µs | n/a |
| **Zod Validation** | | | |
| `safeParse()` valid | 1,995,269 ops/s | 0.50 µs | +22% |
| `safeParse()` invalid | 458,740 ops/s | 2.18 µs | +18% |
| `parse()` valid | 2,436,707 ops/s | 0.41 µs | n/a |
| **CacheManager (MemoryStore)** | | | |
| `get()` — cache hit | 2,419,445 ops/s | 0.41 µs | −9% |
| `get()` — cache miss | 3,760,600 ops/s | 0.27 µs | n/a |
| `set()` | 3,081,303 ops/s | 0.33 µs | +47% |
| `generateKey()` | 2,881,494 ops/s | 0.35 µs | n/a |
| **DIContainer** | | | |
| `resolve()` — singleton (cached) | 1,903,341 ops/s | 0.53 µs | +43% |
| **In-process HTTP Dispatch** | | | |
| `GET /hello` | 182,010 ops/s | 5.49 µs | **+87%** |
| `GET /users/:id` (param extract) | 220,205 ops/s | 4.54 µs | **+158%** |
| `POST /validate` (Zod body) | 138,466 ops/s | 7.22 µs | **+157%** |

**Key observations:**
- **Request dispatch is 1.9–2.6× faster than v0.4.18.** Moving controller resolution, interceptor lookup and parameter/dependency ordering out of the per-request path (they are now resolved once at `compile()` time) is where the gain comes from — see [CHANGELOG](CHANGELOG.md).
- JWT crypto (HMAC-SHA256) remains the slowest operation at ~32–51 K ops/s — expected and unavoidable.
- `isBlacklisted()` is now **async** (it returns a `Promise`, so a pluggable `TokenBlacklist` can hit Redis for multi-instance revocation). The 77 M ops/s figure previously published was a bare synchronous `Map.has()`; 18 M ops/s is the cost of the promise wrapper. At 0.055 µs it is still far below the noise floor of any real request.
- The `compile()` cache-miss speedup comes from deleting precomputation the request path never read (path regex, sorted index arrays, `has*` flags) — it now only computes what the handler actually consumes.
- CacheManager and DI resolution remain effectively free (sub-microsecond).

> Full results: `benchmarks/results/internal-2026-07-26.txt`

---

## HTTP Throughput Comparison — v1.2.0

Comparative performance measurements of **Veloce-TS v1.2.0** against three popular
Node.js/Bun web frameworks, using a single harness (`benchmarks/run.ts`) — all four
servers answer the exact same routes on Bun's native server.

> **Run them yourself:**
> ```bash
> cd benchmarks
> bun install
> bun run run.ts
> ```

---

## Results — Bun 1.3.14 · Windows 11

_15 000 requests · 50 concurrent connections · each server tested in isolation · run 2026-07-26_

### 1. GET /hello — simple JSON response

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **27 557** | 1.11 | 2.31 | 3.15 |
| **Veloce-TS v1.2.0** | **18 561** | 1.65 | 3.64 | 5.77 |
| **Fastify 5**    | **12 063** | 2.39 | 5.42 | 7.04 |
| Express 4        |    8 414 | 3.38 | 7.10 | 9.45 |

No body to parse, no params to extract, no validation — this is pure routing + decorator/DI
dispatch overhead. Hono wins clearly here since Veloce-TS adds a real (if increasingly thin)
layer on top of it for this trivial case.

### 2. GET /users/:id — route parameter extraction

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **26 698** | 1.10 | 2.36 | 3.17 |
| **Veloce-TS v1.2.0** | **25 557** | 1.16 | 2.73 | 3.95 |
| **Fastify 5**    | **14 896** | 1.96 | 4.12 | 5.28 |
| Express 4        |   10 216 | 2.80 | 5.62 | 6.77 |

Essentially tied with raw Hono (**−4.3%**) — the compiled parameter-extraction path
introduced in this release closes almost all of the gap seen on the `/hello` scenario.

### 3. POST /echo — JSON body parse

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Veloce-TS v1.2.0** | **23 588** | 1.23 | 2.84 | 3.73 |
| Hono (raw)       |   20 219 | 1.41 | 3.01 | 4.13 |
| Fastify 5        |   10 682 | 2.49 | 5.36 | 6.56 |
| Express 4        |    7 030 | 3.85 | 7.46 | 10.42 |

**Veloce-TS is +16.7% faster than raw Hono** on this scenario.

### 4. POST /validate — Zod schema validation ⭐

This is where Veloce-TS shines: validation is built into the decorator layer with **zero boilerplate**,
while other frameworks require manual `safeParse` calls.

| Framework        | Req / s   | avg ms | p95 ms | p99 ms | Boilerplate |
|------------------|----------:|-------:|-------:|-------:|-------------|
| **Veloce-TS v1.2.0** | **23 972** | 1.21 | 2.91 | 3.83 | **`@Body(Schema)` only** |
| Hono (raw)       |   16 674 | 1.71 | 3.58 | 4.82 | Manual `safeParse` |
| Fastify 5        |   10 361 | 2.60 | 5.23 | 7.71 | Manual `safeParse` |
| Express 4        |    7 347 | 3.72 | 7.40 | 9.00 | Manual `safeParse` |

**Veloce-TS is +43.8% faster than raw Hono** on this scenario, and beats it despite doing
strictly more work (schema validation) — the compiled parameter/dependency pipeline and
the singleton-by-default controller resolution added in this release outweigh the decorator
overhead once there's real parsing/validation work to amortize it against.

---

## Key Takeaways

| Comparison | Result |
|---|---|
| Veloce-TS vs Express (GET /hello) | **+120.6% faster** |
| Veloce-TS vs Express (GET /users/:id) | **+150.2% faster** |
| Veloce-TS vs Express (POST + body) | **+235.5% faster** |
| Veloce-TS vs Express (validation) | **+226.2% faster** |
| Veloce-TS vs Fastify (validation) | **+131.4% faster** |
| Veloce-TS vs raw Hono (GET /hello, no body/params work) | **−32.6%** slower |
| Veloce-TS vs raw Hono (route params) | **−4.3%** slower (essentially tied) |
| Veloce-TS vs raw Hono (JSON body parse) | **+16.7% faster** |
| Veloce-TS vs raw Hono (Zod validation) | **+43.8% faster** |

The honest summary: Veloce-TS's decorator + DI layer costs real overhead on trivial routes
with nothing else to do (`/hello`), but that overhead is now **outweighed** by the framework's
own optimizations (compiled parameter/dependency arrays, cached interceptor resolution,
singleton controllers by default — see [CHANGELOG](CHANGELOG.md)) as soon as a route does
real work — parsing a body or validating one. On those two scenarios Veloce-TS is faster
than the raw Hono it's built on, not just faster than Express/Fastify.

> These numbers superseded a stale `v0.4.3`-labeled comparison that claimed Veloce-TS was
> "19–37% slower than Hono" across the board — that claim was never re-measured after
> multiple performance passes and had drifted out of sync with reality.

---

## What is being measured

| Scenario | What it tests |
|---|---|
| GET /hello | Pure routing + JSON serialisation |
| GET /users/:id | Route parameter extraction |
| POST /echo | JSON body parsing |
| POST /validate | Zod schema validation (integrated vs manual) |

---

## Methodology

- Each framework runs as an **isolated subprocess** — only one server is active at a time.
- **500 warmup requests** before each measurement to fill JIT caches.
- **15 000 requests** at **50 concurrency** for each measurement.
- RPS = successful responses / total wall-clock seconds elapsed.
- Latency = measured end-to-end from client perspective (includes network round-trip on localhost).
- Tests run on the same machine; results may vary across hardware and OS.
- All four servers run on **Bun's native server** (`Bun.serve`) and answer identical routes — Hono previously ran through the `@hono/node-server` Node compat shim even under Bun, which unfairly penalized it; that's fixed.

### Run environment

```
Runtime : Bun 1.3.14
OS      : Windows 11 (win32)
Requests: 15 000  |  Concurrency: 50  |  Warmup: 500
Captured: 2026-07-26 (see benchmarks/results/latest.json)
```

### How to reproduce

```bash
# From the Veloce-TS repo root:
cd benchmarks
bun install
bun run run.ts

# Options:
# --requests 10000     change request count
# --concurrency 100    change concurrency level
# --scenario hello     run only one scenario (hello|params|body|validation)
# --json               also print JSON output
```

---

## Disclaimer

These benchmarks test **framework overhead only** on localhost. Production performance
depends on database queries, business logic, network latency, and deployment environment.
Always profile your own application under realistic conditions.
