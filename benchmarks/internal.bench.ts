/**
 * Veloce-TS Internal Micro-Benchmarks
 * Measures framework internals without network overhead.
 *
 * Run: bun benchmarks/internal.bench.ts
 */
import 'reflect-metadata';
import { z } from 'zod';

// ── Manual benchmark runner ───────────────────────────────────────────────────

async function bench(
  name: string,
  fn: () => any,
  iterations = 100_000,
): Promise<void> {
  // warmup
  for (let i = 0; i < Math.min(1_000, iterations / 10); i++) {
    const r = fn();
    if (r instanceof Promise) await r;
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const r = fn();
    if (r instanceof Promise) await r;
  }
  const ms = performance.now() - start;

  const opsPerSec = Math.round(iterations / (ms / 1_000));
  const usPerOp   = ((ms / iterations) * 1_000).toFixed(3);
  console.log(
    `  ${name.padEnd(50)} ${opsPerSec.toLocaleString().padStart(13)} ops/s  (${usPerOp} µs/op)`,
  );
}

async function group(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}─`);
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

console.log('\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║          Veloce-TS Internal Micro-Benchmarks                  ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');

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

const date = new Date().toISOString().split('T')[0];
const filename = join(resultsDir, `internal-${date}.txt`);
// Capture was not set up for redirect — note the file location
writeFileSync(filename, `# Veloce-TS Internal Benchmarks — ${new Date().toISOString()}\n# Re-run: bun benchmarks/internal.bench.ts\n`);

console.log(`\n  Results: ${filename}`);
console.log('  Done!\n');
