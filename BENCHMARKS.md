# Veloce-TS Benchmarks

Comparative performance measurements of **Veloce-TS v0.4.3** against three popular
Node.js/Bun web frameworks.

> **Run them yourself:**
> ```bash
> cd benchmarks
> bun install
> bun run run.ts
> ```

---

## Results — Bun 1.3.5 · Windows 11 · Ryzen 5

_6 000 requests · 50 concurrent connections · each server tested in isolation · run 2026-03-28_

### 1. GET /hello — simple JSON response

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **30 376** | 0.95 | 1.70 | 2.62 |
| **Veloce-TS v0.4.3** | **19 252** | 1.43 | 2.76 | 5.79 |
| **Fastify 5**    | **16 918** | 1.58 | 3.49 | 5.45 |
| Express 4        |   14 189 | 1.83 | 3.64 | 5.05 |

### 2. GET /users/:id — route parameter extraction

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **28 479** | 1.00 | 1.75 | 2.60 |
| **Veloce-TS v0.4.3** | **22 219** | 1.23 | 2.18 | 3.02 |
| **Fastify 5**    | **19 375** | 1.36 | 2.52 | 3.32 |
| Express 4        |   15 084 | 1.73 | 3.21 | 4.15 |

### 3. POST /echo — JSON body parse

| Framework        | Req / s   | avg ms | p95 ms | p99 ms |
|------------------|----------:|-------:|-------:|-------:|
| **Hono (raw)**   | **23 271** | 1.16 | 2.02 | 2.69 |
| **Veloce-TS v0.4.3** | **18 788** | 1.40 | 2.52 | 3.42 |
| Fastify 5        |   13 768 | 1.85 | 3.54 | 4.62 |
| Express 4        |   10 110 | 2.50 | 4.69 | 5.89 |

### 4. POST /validate — Zod schema validation ⭐

This is where Veloce-TS shines: validation is built into the decorator layer with **zero boilerplate**,
while other frameworks require manual `safeParse` calls.

| Framework        | Req / s   | avg ms | p95 ms | p99 ms | Boilerplate |
|------------------|----------:|-------:|-------:|-------:|-------------|
| **Hono (raw)**   | **19 722** | 1.35 | 2.49 | 3.27 | Manual `safeParse` |
| **Veloce-TS v0.4.3** | **15 988** | 1.64 | 2.98 | 4.11 | **`@Body(Schema)` only** |
| Fastify 5        |   13 265 | 1.95 | 3.62 | 4.36 | Manual `safeParse` |
| Express 4        |    9 930 | 2.57 | 4.81 | 6.26 | Manual `safeParse` |

---

## Key Takeaways

| Comparison | Result |
|---|---|
| Veloce-TS vs Express (GET /hello) | **+36 % faster** |
| Veloce-TS vs Express (GET /users/:id) | **+47 % faster** |
| Veloce-TS vs Express (POST + body) | **+86 % faster** |
| Veloce-TS vs Express (validation) | **+61 % faster** |
| Veloce-TS vs Fastify (validation) | **+21 % faster** |
| Veloce-TS vs raw Hono overhead | About **−19 % to −37 %** slower (scenario-dependent) |

The decorator + DI layer of Veloce-TS adds **roughly sub–2 ms** average latency versus raw Hono on these runs. In exchange, you get automatic Zod validation, OpenAPI generation,
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
OS      : Windows 11 (win32)
CPU     : AMD Ryzen 5
Requests: 6 000  |  Concurrency: 50  |  Warmup: 500
Captured: 2026-03-28 (see benchmarks/results/latest.json)
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
