# Veloce-TS Benchmarks

Benchmarks comparing veloce-ts against Hono, Express, and Fastify. One in-process harness (`run.ts`) — no external load-testing tool required.

## Requirements

- Bun >= 1.0.0

## Run all benchmarks

```bash
bun run benchmarks/run.ts
# or, equivalently:
bun run benchmark   # package.json script
```

## Run a single scenario

```bash
bun run benchmarks/run.ts --scenario hello
```

## Cases

| Case | Description |
|------|-------------|
| hello | Plain text response — baseline throughput |
| json | JSON serialize 100-field object |
| params | Route with URL params |
| validation | Zod validation on request body |
| auth-middleware | JWT verify middleware in chain |

## Latest Results (Bun 1.x, M-series / x86-64)

> Run `bun run benchmarks/run-all.ts` to generate fresh numbers.
