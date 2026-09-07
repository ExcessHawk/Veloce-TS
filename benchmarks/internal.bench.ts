/**
 * Veloce-TS Internal Micro-Benchmarks
 * Measures framework internals without network overhead.
 *
 * Run: bun benchmarks/internal.bench.ts
 */
import 'reflect-metadata';
import { z } from 'zod';

// ── Output capture ────────────────────────────────────────────────────────────
// Every line is mirrored into `transcript` so the results file gets the actual
// measurements. Previously only a 2-line header was written, leaving
// benchmarks/results/internal-*.txt effectively empty.

const transcript: string[] = [];

function log(line = ''): void {
  transcript.push(line);
  console.log(line);
}

// ── Manual benchmark runner ───────────────────────────────────────────────────

/**
 * Rounds measured per benchmark. The previous harness timed a single loop, so
 * one GC pause or CPU-frequency change landed entirely in the published number —
 * repeat runs of the same operation on the same machine ranged from 7.5M to
 * 15.8M ops/s. Several rounds plus a median makes a stray pause an outlier
 * instead of the result.
 */
const ROUNDS = 7;

/** Above this relative spread the sample is too unstable to quote. */
const NOISE_THRESHOLD = 0.15;

/**
 * Target wall time per round.
 *
 * Iteration counts are calibrated to hit this rather than being fixed per
 * benchmark. With a fixed count, a sub-microsecond operation finishes a round in
 * a few milliseconds, and a single GC pause or scheduler slice then dominates
 * the measurement — which is why the same operation could differ 2× between
 * rounds. A round long enough to amortise those events is what makes repeat
 * runs agree.
 */
const TARGET_ROUND_MS = 250;

interface Measurement {
  opsPerSec: number;
  usPerOp: number;
  /** Interquartile range over the median — robust to a single stray round. */
  spread: number;
  iterations: number;
}

/** Time one pass of `iterations` calls, returning elapsed milliseconds. */
async function timeRound(fn: () => any, iterations: number): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const r = fn();
    if (r instanceof Promise) await r;
  }
  return performance.now() - start;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Value at `q` (0..1) of a sorted-on-the-fly sample. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pick an iteration count that makes a round last about {@link TARGET_ROUND_MS},
 * measured from a short probe. Also serves as JIT warmup.
 */
async function calibrate(fn: () => any, hint: number): Promise<number> {
  let iterations = Math.max(1, Math.min(hint, 1_000));
  let elapsed = 0;

  // Grow until a round is long enough to time meaningfully.
  for (let attempt = 0; attempt < 20; attempt++) {
    elapsed = await timeRound(fn, iterations);
    if (elapsed >= 25) break;
    iterations *= 4;
  }

  const scaled = Math.round(iterations * (TARGET_ROUND_MS / Math.max(elapsed, 0.001)));
  return Math.max(100, Math.min(scaled, 20_000_000));
}

async function measure(fn: () => any, hint: number): Promise<Measurement> {
  const iterations = await calibrate(fn, hint);

  // One more untimed round at the real size: the JIT needs far more than the
  // 1,000 iterations the old harness allowed before it reaches steady state.
  await timeRound(fn, iterations);

  const rounds: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    rounds.push(await timeRound(fn, iterations));
  }

  const ms = median(rounds);

  return {
    opsPerSec: Math.round(iterations / (ms / 1_000)),
    usPerOp: (ms / iterations) * 1_000,
    // IQR rather than min-max: one descheduled round should not condemn an
    // otherwise steady sample.
    spread: (quantile(rounds, 0.75) - quantile(rounds, 0.25)) / ms,
    iterations,
  };
}

async function bench(
  name: string,
  fn: () => any,
  iterations = 100_000,
): Promise<void> {
  const { opsPerSec, usPerOp, spread } = await measure(fn, iterations);

  // Print the spread rather than a bare number: a reader can then tell a solid
  // measurement from one the machine was too busy to take.
  const spreadPct = `±${(spread * 100).toFixed(1)}%`;
  const flag = spread > NOISE_THRESHOLD ? '  ⚠ noisy' : '';

  log(
    `  ${name.padEnd(50)} ${opsPerSec.toLocaleString().padStart(13)} ops/s  ` +
    `(${usPerOp.toFixed(3)} µs/op, ${spreadPct})${flag}`,
  );

  if (spread > NOISE_THRESHOLD) {
    noisy.push(name);
  }
}

/** Benchmarks whose rounds disagreed too much to be quoted as fact. */
const noisy: string[] = [];

async function group(name: string, fn: () => Promise<void>): Promise<void> {
  log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}─`);
  await fn();
}

// ── Imports ───────────────────────────────────────────────────────────────────

import { MetadataCompiler } from '../src/core/compiled-metadata';
import { MetadataRegistry }  from '../src/core/metadata';
import { JWTProvider }       from '../src/auth/jwt-provider';
import { CacheManager, MemoryCacheStore } from '../src/cache';
import { DIContainer }       from '../src/dependencies/container';
import { Controller, Get, Post } from '../src/decorators/http';
import { Param, Body } from '../src/decorators/params';
import { VeloceTS } from '../src/core/application';

// ── Setup ─────────────────────────────────────────────────────────────────────

const SECRET = 'bench-secret-key-32chars-long!!x';

// Pre-built JWT provider & access token
const jwt = new JWTProvider({ secret: SECRET, expiresIn: '1h', refreshExpiresIn: '7d' });
const { accessToken } = jwt.generateTokens({ sub: 'bench-user', role: 'admin' });

// Zod schema
const UserSchema = z.object({
  name:  z.string().min(1),
  email: z.string().email(),
  age:   z.number().int().min(0),
});
const VALID_USER   = { name: 'Alice', email: 'alice@example.com', age: 30 };
const INVALID_USER = { name: '',      email: 'not-an-email',      age: -1 };

// DI container
class SimpleSvc { getValue() { return 42; } }
const container = new DIContainer();

// Pre-warm DI singleton
await container.resolve(SimpleSvc);

// App controller for dispatch bench
@Controller('/api')
class BenchController {
  @Get('/hello')
  hello() { return { ok: true }; }

  @Get('/users/:id')
  getUser(@Param('id') id: string) { return { id }; }

  @Post('/validate')
  create(@Body(UserSchema) body: z.infer<typeof UserSchema>) { return body; }
}

const app = new VeloceTS({ docs: false });
app.include(BenchController);
await app.compile();
const hono = app.getHono();

// Build a synthetic RouteMetadata object for MetadataCompiler bench
const benchRoute = {
  target: BenchController,
  propertyKey: 'getUser',
  method: 'GET' as const,
  path: '/api/users/:id',
  parameters: [{ index: 0, type: 'param' as const, name: 'id' }],
  dependencies: [],
  middleware: [],
};
const routes = [benchRoute];
const firstRoute = benchRoute;

// ── Benchmarks ────────────────────────────────────────────────────────────────

log('\n╔═══════════════════════════════════════════════════════════════╗');
log('║          Veloce-TS Internal Micro-Benchmarks                  ║');
log('╚═══════════════════════════════════════════════════════════════╝');

await group('JWT Operations', async () => {
  await bench('JWTProvider.generateTokens()', () =>
    jwt.generateTokens({ sub: 'u1', role: 'admin' }), 50_000);

  await bench('JWTProvider.verifyAccessToken()', () =>
    jwt.verifyAccessToken(accessToken), 100_000);

  await bench('JWTProvider.decodeToken()', () =>
    jwt.decodeToken(accessToken), 200_000);

  await bench('JWTProvider.isBlacklisted() – not blacklisted', () =>
    jwt.isBlacklisted(accessToken), 1_000_000);
});

await group('MetadataCompiler', async () => {
  // Clear cache so first call is a cache miss
  MetadataCompiler.clearCache();
  let missHappened = false;
  await bench('MetadataCompiler.compile() – cache miss (first call)', () => {
    if (!missHappened) {
      MetadataCompiler.clearCache();
      missHappened = true;
    }
    MetadataCompiler.clearCache();
    return MetadataCompiler.compile(firstRoute);
  }, 10_000);

  // Warm up the cache
  MetadataCompiler.compile(firstRoute);
  await bench('MetadataCompiler.compile() – cache hit', () =>
    MetadataCompiler.compile(firstRoute), 500_000);

  await bench('MetadataCompiler.compileAll() – 3 routes', () =>
    MetadataCompiler.compileAll(routes), 100_000);
});

await group('MetadataRegistry', async () => {
  await bench('MetadataRegistry.getRouteMethods()', () =>
    MetadataRegistry.getRouteMethods(BenchController), 500_000);

  await bench('MetadataRegistry.getRouteMetadata()', () =>
    MetadataRegistry.getRouteMetadata(BenchController.prototype, 'getUser'), 500_000);
});

await group('Zod Validation', async () => {
  await bench('z.object().safeParse() – valid input', () =>
    UserSchema.safeParse(VALID_USER), 200_000);

  await bench('z.object().safeParse() – invalid input', () =>
    UserSchema.safeParse(INVALID_USER), 200_000);

  await bench('z.object().parse() – valid input', () =>
    UserSchema.parse(VALID_USER), 200_000);
});

await group('CacheManager (in-memory)', async () => {
  CacheManager.reset();
  await CacheManager.set('bench-key', { value: 42 });

  await bench('CacheManager.set(key, value)', async () =>
    CacheManager.set('k', { v: 1 }), 50_000);

  await bench('CacheManager.get(key) – hit', async () =>
    CacheManager.get('bench-key'), 100_000);

  await bench('CacheManager.get(key) – miss', async () =>
    CacheManager.get('__no_such_key__'), 100_000);

  await bench('CacheManager.generateKey() – method+path', () =>
    CacheManager.generateKey('GET', '/api/users/123', { id: '123' }), 500_000);
});

await group('MemoryCacheStore (raw)', async () => {
  const store = new MemoryCacheStore({ cleanupInterval: 0 });
  await store.set('k', { value: 1 });

  await bench('MemoryCacheStore.set()', async () =>
    store.set('key', { v: Math.random() }), 100_000);

  await bench('MemoryCacheStore.get() – hit', async () =>
    store.get('k'), 200_000);

  await bench('MemoryCacheStore.get() – miss', async () =>
    store.get('__miss__'), 200_000);

  await bench('MemoryCacheStore.has() – hit', async () =>
    store.has('k'), 200_000);

  store.destroy();
});

await group('DIContainer', async () => {
  await bench('DIContainer.resolve() – singleton (cached)', async () =>
    container.resolve(SimpleSvc), 50_000);
});

await group('HTTP Request Dispatch (in-process, no network)', async () => {
  await bench('GET /api/hello', async () =>
    hono.fetch(new Request('http://localhost/api/hello')), 20_000);

  await bench('GET /api/users/:id (param extraction)', async () =>
    hono.fetch(new Request('http://localhost/api/users/42')), 20_000);

  await bench('POST /api/validate (Zod body validation)', async () =>
    hono.fetch(new Request('http://localhost/api/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_USER),
    })), 10_000);
});

// Save results to file
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const resultsDir = join(import.meta.dir, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

// Summarise reliability before writing the file, so the transcript carries it.
if (noisy.length > 0) {
  log('');
  log(`⚠  ${noisy.length} benchmark(s) varied more than ${NOISE_THRESHOLD * 100}% between rounds:`);
  for (const name of noisy) log(`     ${name}`);
  log('   Treat those as indicative only — close other work and re-run before quoting them.');
} else {
  log('');
  log(`✓  Every benchmark stayed within ${NOISE_THRESHOLD * 100}% across ${ROUNDS} rounds.`);
}

const date = new Date().toISOString().split('T')[0];
const filename = join(resultsDir, `internal-${date}.txt`);
writeFileSync(
  filename,
  [
    `# Veloce-TS Internal Benchmarks — ${new Date().toISOString()}`,
    `# Bun ${(Bun as any).version} · ${process.platform}`,
    '# Re-run: bun benchmarks/internal.bench.ts',
    '',
    ...transcript,
    '',
  ].join('\n'),
);

console.log(`\n  Results: ${filename}`);
console.log('  Done!\n');

// Release cache cleanup intervals — without this the default MemoryCacheStore's
// 60s setInterval keeps the event loop alive and the process never exits.
CacheManager.destroy();
