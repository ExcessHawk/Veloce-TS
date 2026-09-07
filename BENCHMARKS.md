# Veloce-TS Benchmarks

_Last run: 2026-09-07 · Veloce-TS 3.2.0 · Bun 1.3.14 · Windows 11 · 5 rounds, median reported._

> **Correction (3.2.0).** Earlier editions of this file claimed Veloce-TS *beat* raw Hono on
> JSON body parsing (+16.7%) and Zod validation (+43.8%). **Those numbers were measurement
> noise, and the sign was wrong.** They came from a single timed pass per framework, and a
> single pass is not a measurement: three consecutive runs of the identical scenario on the
> same machine put Hono ahead by 2%, then by 17%, then level — and a fourth put Veloce ahead
> by 14%. Repeating each measurement and taking the median puts Hono ahead in every scenario,
> which is also the only physically sensible answer: **Veloce-TS is a layer on top of Hono, so
> it cannot be faster than Hono at the same work.** The figures below are what the corrected
> harness reports.

## How these are measured

Both harnesses were reworked in 3.2.0 after the numbers above proved unreproducible.

- **Repeat rounds, median reported.** A single pass is dominated by whatever the machine
  happened to be doing — a GC pause or a scheduler slice lands entirely in the result.
- **Spread is shown.** Every internal benchmark prints how much its rounds disagreed. A number
  without its variance invites more confidence than it earned.
- **Rounds are calibrated by wall time, not iteration count.** A sub-microsecond operation run
  a fixed 100k times finishes in a few milliseconds, which is far too short to average anything
  out. Iterations are scaled so each round lasts ~250 ms.
- **Servers are rotated across rounds.** The comparison starts each server in turn and repeats
  the rotation, so machine drift is spread over all of them instead of being charged to
  whichever ran first.
- **Noisy results are flagged, not quoted.** The internal harness marks any benchmark whose
  rounds varied by more than 15% and says so in its summary.

Reproduce:

```bash
bun run benchmark                                    # internal micro-benchmarks
cd benchmarks && bun run.ts --rounds 5               # framework comparison
```

## Framework comparison

4 000 requests per round, concurrency 25, 5 rounds, median req/s. All four servers answer
identical routes and run on `Bun.serve`.

| Scenario | Veloce-TS 3.2.0 | Hono (raw) | Express 4 | Fastify 5 |
|---|---:|---:|---:|---:|
| `GET /hello` — simple JSON | 9 337 | **10 496** | 5 145 | 6 640 |
| `GET /users/:id` — route params | 9 626 | **10 147** | 5 080 | 7 207 |
| `POST /echo` — JSON body parse | 7 525 | **8 030** | 3 947 | 5 246 |
| `POST /validate` — Zod validation | 7 953 | **8 141** | 3 965 | 5 502 |

### What this actually says

- **Veloce-TS costs 2–11% over raw Hono.** That is the price of the decorator layer: route
  metadata, parameter extraction, DI resolution and response serialisation. The gap is widest on
  `/hello`, where there is no real work to amortise it against, and narrowest on `/validate`,
  where Zod dominates both sides.
- **Veloce-TS is roughly 1.8–1.9× faster than Express 4** and **1.3–1.4× faster than Fastify 5**
  on these scenarios, under Bun.
- If raw throughput on trivial routes is what you are optimising for, use Hono directly. Veloce-TS
  trades a single-digit percentage for validation, DI, OpenAPI and the decorator API.

### Caveats worth stating

- Measured on one Windows laptop under Bun. Absolute req/s says more about the machine than the
  framework; treat the *ratios* as the result and re-run locally before relying on them.
- Express and Fastify are running under Bun here, not under Node where they are usually deployed.
  That is what makes the comparison a same-runtime one, but it is not their native setting.
- Elysia and NestJS are not included.

## Internal micro-benchmarks

In-process measurements of framework internals — no network, no TCP. Each figure is the median
of 7 rounds; `±` is the interquartile spread across those rounds.

Run `bun run benchmark` for the current numbers on your own machine. The harness prints the
spread next to every result and lists at the end any benchmark whose rounds disagreed by more
than 15%, so an unreliable measurement announces itself rather than being published as fact.

On the reference machine most operations land in these ranges:

| Area | Throughput | Notes |
|---|---:|---|
| `MetadataRegistry.getRouteMetadata()` | ~6.6M ops/s | reflect-metadata read |
| `MemoryCacheStore.get()` — hit | ~2.7M ops/s | |
| `CacheManager.set()` | ~2.5M ops/s | |
| `DIContainer.resolve()` — cached singleton | ~1.4M ops/s | the common path |
| `z.object().safeParse()` — valid | ~1.8M ops/s | Zod, not framework code |
| HTTP dispatch, `GET /hello` | ~86k ops/s | in-process, no network |

Those are indicative. The point of the harness is the variance column, not the headline number:
a request costs on the order of 10 µs of dispatch, so a DI resolve at 0.7 µs is 7% of it, and
micro-optimising anything below that is measuring the machine rather than the framework.
