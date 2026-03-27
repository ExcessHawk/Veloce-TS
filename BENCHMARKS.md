# Veloce-TS Benchmarks

Comparative performance measurements of **Veloce-TS v0.4.1** against three popular
Node.js/Bun web frameworks.

> **Run them yourself:**
> ```bash
> cd benchmarks
> bun install
> bun run run.ts
> ```

---

## Results — Bun 1.3.5 · Windows 11 · Ryzen 5

_6 000 requests · 50 concurrent connections · each server tested in isolation_

### 1. GET /hello — simple JSON response

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **30 593** | 0.95 | 1.87 | 2.87 |
| **Fastify 5**    | **17 874** | 1.48 | 2.97 | 4.08 |
| **Veloce-TS v0.4.1** | **16 688** | 1.62 | 3.03 | 3.66 |
| Express 4        |   13 618 | 1.92 | 4.02 | 5.51 |

### 2. GET /users/:id — route parameter extraction

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **29 248** | 0.98 | 1.87 | 2.66 |
| **Fastify 5**    | **19 853** | 1.34 | 2.44 | 3.11 |
| **Veloce-TS v0.4.1** | **17 337** | 1.56 | 3.13 | 4.04 |
| Express 4        |   14 337 | 1.83 | 3.85 | 5.06 |

### 3. POST /echo — JSON body parse

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **22 187** | 1.21 | 2.17 | 3.04 |
| **Veloce-TS v0.4.1** | **16 117** | 1.64 | 3.09 | 4.06 |
| Fastify 5        |   13 758 | 1.86 | 3.53 | 4.24 |
| Express 4        |    8 513 | 3.06 | 5.86 | 12.18 |

### 4. POST /validate — Zod schema validation ⭐

This is where Veloce-TS shines: validation is built into the decorator layer with **zero boilerplate**,
while other frameworks require manual `safeParse` calls.

| Framework        | Req / s   | avg ms | p95 ms | p99 ms | Boilerplate |
|------------------|----------:|-------:|-------:|-------:|-------------|
| **Hono (raw)**   | **19 018** | 1.37 | 2.55 | 3.35 | Manual `safeParse` |
| **Veloce-TS v0.4.1** | **15 405** | 1.68 | 3.19 | 4.33 | **`@Body(Schema)` only** |
| Fastify 5        |   12 827 | 1.98 | 3.86 | 4.98 | Manual `safeParse` |
| Express 4        |    9 794 | 2.58 | 4.93 | 6.21 | Manual `safeParse` |

---

## Key Takeaways

| Comparison | Result |
|---|---|
| Veloce-TS vs Express (GET) | **+22 % faster** |
| Veloce-TS vs Express (POST + body) | **+89 % faster** |
| Veloce-TS vs Express (validation) | **+57 % faster** |
| Veloce-TS vs Fastify (validation) | **+20 % faster** |
| Veloce-TS vs raw Hono overhead | Only **−13 % to −43 %** slower |

The decorator + DI layer of Veloce-TS adds **~1–2 ms** of overhead per request compared
to raw Hono. In exchange, you get automatic Zod validation, OpenAPI generation,
dependency injection, and type-safe route parameters — for free.

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
- **6 000 requests** at **50 concurrency** for each measurement.
- RPS = successful responses / total wall-clock seconds elapsed.
- Latency = measured end-to-end from client perspective (includes network round-trip on localhost).
- Tests run on the same machine; results may vary across hardware and OS.

### Run environment

```
Runtime : Bun 1.3.5
OS      : Windows 11
CPU     : AMD Ryzen 5
Requests: 6 000  |  Concurrency: 50  |  Warmup: 500
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
