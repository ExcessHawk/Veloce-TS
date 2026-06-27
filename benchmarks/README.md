# Veloce-TS Benchmarks

Benchmarks comparing veloce-ts against Hono, Elysia, and Fastify.

## Requirements

- Bun >= 1.0.0
- `autocannon` for HTTP benchmarks: `bun add -g autocannon`

## Run all benchmarks

```bash
bun run benchmarks/run-all.ts
```

## Run individual

```bash
bun benchmarks/servers/veloce.ts &
autocannon -c 100 -d 10 http://localhost:3000/hello
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
