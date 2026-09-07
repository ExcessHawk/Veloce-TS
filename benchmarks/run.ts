/**
 * Veloce-TS Benchmark Runner
 *
 * Usage:
 *   bun run run.ts                        # all scenarios
 *   bun run run.ts --scenario hello       # single scenario
 *   bun run run.ts --json                 # output JSON results
 *   bun run run.ts --requests 5000        # custom request count
 *   bun run run.ts --concurrency 100      # custom concurrency
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Read the framework version from package.json instead of hardcoding it —
// this label previously said "v0.4.3" while the framework had moved on to
// 1.2.0, silently going stale every release.
const PKG_VERSION: string = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8'),
).version;

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${flag}=`))?.split('=')[1] ??
  (args.includes(`--${flag}`) ? args[args.indexOf(`--${flag}`) + 1] : fallback);

const TOTAL_REQUESTS  = Number(getArg('requests', '10000'));
const CONCURRENCY     = Number(getArg('concurrency', '50'));
const WARMUP_REQUESTS = 500;
/**
 * Times the whole server rotation is repeated. Each (server, scenario) pair is
 * reported as the median of its rounds, with the spread alongside.
 *
 * One pass is not a measurement: repeat runs of the same scenario on the same
 * machine put Hono ahead by 2%, then 17%, then level — and a fourth put Veloce
 * ahead by 14%. Rotating the servers several times also spreads machine drift
 * across all of them instead of charging it to whichever ran first.
 */
const ROUNDS = Number(getArg('rounds', '3'));
const OUTPUT_JSON     = args.includes('--json');
const SCENARIO_FILTER = getArg('scenario', 'all');

const SERVERS = [
  { name: `Veloce-TS v${PKG_VERSION}`, file: './servers/veloce.ts', port: 3001, color: '\x1b[36m' },
  { name: 'Hono (raw)',                 file: './servers/hono.ts',   port: 3002, color: '\x1b[33m' },
  { name: 'Express 4',                  file: './servers/express.ts',port: 3003, color: '\x1b[90m' },
  { name: 'Fastify 5',                  file: './servers/fastify.ts',port: 3004, color: '\x1b[35m' },
] as const;

const SCENARIOS: Record<string, { method: string; path: string; body?: object; label: string }> = {
  hello: {
    label: 'GET /hello — simple JSON response',
    method: 'GET',
    path: '/hello',
  },
  params: {
    label: 'GET /users/:id — route parameter extraction',
    method: 'GET',
    path: '/users/42',
  },
  body: {
    label: 'POST /echo — JSON body parse',
    method: 'POST',
    path: '/echo',
    body: { message: 'benchmark', value: 42, nested: { ok: true } },
  },
  validation: {
    label: 'POST /validate — Zod schema validation',
    method: 'POST',
    path: '/validate',
    body: { name: 'Alice', email: 'alice@example.com', age: 30 },
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchResult {
  rps: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errors: number;
  total: number;
}

// ── Core benchmark ────────────────────────────────────────────────────────────

async function runRequests(
  url: string,
  method: string,
  body: object | undefined,
  count: number,
  concurrency: number,
): Promise<BenchResult> {
  const latencies: number[] = [];
  let errors = 0;

  const headers: Record<string, string> = body
    ? { 'Content-Type': 'application/json' }
    : {};
  const bodyStr = body ? JSON.stringify(body) : undefined;

  const send = async () => {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { method, headers, body: bodyStr });
      const elapsed = performance.now() - t0;
      await res.text(); // drain
      if (res.status >= 500) {
        errors++;
      } else {
        latencies.push(elapsed);
      }
    } catch {
      errors++;
    }
  };

  // Track actual wall-clock time for correct RPS calculation
  const wallStart = performance.now();

  const batches = Math.ceil(count / concurrency);
  for (let b = 0; b < batches; b++) {
    const size = Math.min(concurrency, count - b * concurrency);
    await Promise.all(Array.from({ length: size }, send));
  }

  const wallSec = (performance.now() - wallStart) / 1000;

  if (latencies.length === 0) {
    return { rps: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, errors, total: count };
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  const p = (pct: number) => latencies[Math.floor(latencies.length * pct)] ?? 0;

  // Correct RPS: successful responses / actual elapsed wall-clock seconds
  const rps = Math.round(latencies.length / wallSec);

  return {
    rps,
    avgMs: +avg.toFixed(2),
    p50Ms: +p(0.5).toFixed(2),
    p95Ms: +p(0.95).toFixed(2),
    p99Ms: +p(0.99).toFixed(2),
    errors,
    total: count,
  };
}

// ── Wait for server to be ready ───────────────────────────────────────────────

async function waitForServer(port: number, timeout = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/hello`);
      return true;
    } catch {
      await Bun.sleep(150);
    }
  }
  return false;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const DIM   = '\x1b[2m';

function bar(value: number, max: number, width = 20): string {
  const filled = Math.round((value / max) * width);
  return GREEN + '█'.repeat(filled) + DIM + '░'.repeat(width - filled) + RESET;
}

function printTable(
  scenario: string,
  results: { name: string; color: string; result: BenchResult }[],
) {
  const maxRps = Math.max(...results.map((r) => r.result.rps));
  console.log(`\n${BOLD}${scenario}${RESET}`);
  console.log('─'.repeat(90));
  console.log(
    `${'Framework'.padEnd(22)} ${'Req/s'.padStart(8)}  ${'avg ms'.padStart(8)}  ${'p95 ms'.padStart(8)}  ${'p99 ms'.padStart(8)}  Bar`,
  );
  console.log('─'.repeat(90));

  for (const { name, color, result } of results) {
    const rpsLabel = result.rps.toLocaleString().padStart(8);
    const avgLabel = result.avgMs.toFixed(2).padStart(8);
    const p95Label = result.p95Ms.toFixed(2).padStart(8);
    const p99Label = result.p99Ms.toFixed(2).padStart(8);
    const errNote  = result.errors > 0 ? RED + ` (${result.errors} err)` + RESET : '';
    console.log(
      `${color}${name.padEnd(22)}${RESET} ${BOLD}${rpsLabel}${RESET}  ${avgLabel}  ${p95Label}  ${p99Label}  ${bar(result.rps, maxRps)}${errNote}`,
    );
  }
  console.log('─'.repeat(90));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const titleLine = `Veloce-TS  Benchmark Suite  v${PKG_VERSION}`;
console.log(`\n${BOLD}╔══════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}║ ${titleLine.padEnd(50)} ║${RESET}`);
console.log(`${BOLD}╚══════════════════════════════════════════════════╝${RESET}`);
console.log(`  Requests: ${TOTAL_REQUESTS.toLocaleString()}   Concurrency: ${CONCURRENCY}   Warmup: ${WARMUP_REQUESTS}`);

const scenariosToRun = SCENARIO_FILTER === 'all'
  ? Object.entries(SCENARIOS)
  : Object.entries(SCENARIOS).filter(([k]) => k === SCENARIO_FILTER);

if (scenariosToRun.length === 0) {
  console.error(`Unknown scenario "${SCENARIO_FILTER}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}

// ── Run each server INDIVIDUALLY (one at a time) for fair, isolated results ──

const allResults: Record<string, { name: string; color: string; result: BenchResult }[]> = {};

/** Every round's req/s, keyed by `scenario\u0000server`. */
const samples: Record<string, number[]> = {};

// Initialise result buckets
for (const [key] of scenariosToRun) {
  allResults[key] = [];
}

for (let round = 1; round <= ROUNDS; round++) {
  if (ROUNDS > 1) {
    console.log(`\n${BOLD}Round ${round}/${ROUNDS}${RESET}`);
  }

for (const server of SERVERS) {
  console.log(`\n${server.color}${BOLD}▶ ${server.name}${RESET} (:${server.port})`);

  // Start this server
  const proc = Bun.spawn(['bun', 'run', server.file], {
    cwd: import.meta.dir,
    env: { ...process.env, BENCH_PORT: String(server.port) },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  process.stdout.write('  Starting… ');
  const ready = await waitForServer(server.port);
  if (!ready) {
    console.log(`${RED}timeout — skipping${RESET}`);
    proc.kill();
    continue;
  }
  console.log(`${GREEN}ready${RESET}`);

  // Run every scenario against this server
  for (const [key, scenario] of scenariosToRun) {
    const url = `http://localhost:${server.port}${scenario.path}`;

    process.stdout.write(`  ${DIM}${scenario.label}${RESET} → warmup… `);
    await runRequests(url, scenario.method, scenario.body, WARMUP_REQUESTS, CONCURRENCY);
    process.stdout.write('measuring… ');

    const t0 = Date.now();
    const result = await runRequests(url, scenario.method, scenario.body, TOTAL_REQUESTS, CONCURRENCY);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const errNote = result.errors > 0 ? ` ${RED}(${result.errors} err)${RESET}` : '';
    console.log(`${BOLD}${result.rps.toLocaleString()} req/s${RESET}  avg ${result.avgMs}ms  p99 ${result.p99Ms}ms${errNote}  (${elapsed}s)`);

    const sampleKey = `${key}\u0000${server.name}`;
    (samples[sampleKey] ??= []).push(result.rps);

    // Keep the last round's latency figures, but replace req/s with the median
    // across rounds once every round has been collected.
    const existing = allResults[key].find((r) => r.name === server.name);
    if (existing) {
      existing.result = result;
    } else {
      allResults[key].push({ name: server.name, color: server.color, result });
    }
  }

  // Stop server before starting next one
  proc.kill();
  await Bun.sleep(300); // let port be freed
}
}

// Replace each single-run req/s with the median of its rounds, and record how
// much the rounds disagreed so the tables can show it.
const spreads: Record<string, number> = {};
for (const [key, entries] of Object.entries(allResults)) {
  for (const entry of entries) {
    const runs = samples[`${key}\u0000${entry.name}`] ?? [entry.result.rps];
    const sorted = [...runs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    entry.result = { ...entry.result, rps: Math.round(med) };
    spreads[`${key}\u0000${entry.name}`] =
      med > 0 ? (sorted[sorted.length - 1] - sorted[0]) / med : 0;
  }
}

// Print comparison tables per scenario
console.log('\n');
for (const [key, results] of Object.entries(allResults)) {
  if (results.length === 0) continue;
  printTable(SCENARIOS[key].label, results);
}

// Summary: fastest framework per scenario
console.log(`\n${BOLD}Summary — fastest req/s per scenario${RESET}`);
console.log('─'.repeat(70));
for (const [key, results] of Object.entries(allResults)) {
  if (results.length < 2) continue;
  const sorted = [...results].sort((a, b) => b.result.rps - a.result.rps);
  const winner   = sorted[0];
  const runnerUp = sorted[1];
  const diff = runnerUp.result.rps > 0
    ? ((winner.result.rps / runnerUp.result.rps - 1) * 100).toFixed(1)
    : '∞';
  console.log(
    `  ${SCENARIOS[key].label.padEnd(46)} ${winner.color}${BOLD}${winner.name}${RESET}  +${diff}% vs ${runnerUp.name}`,
  );
}
console.log('─'.repeat(70));

// Save JSON results
const output = {
  meta: {
    date: new Date().toISOString(),
    requests: TOTAL_REQUESTS,
    concurrency: CONCURRENCY,
    warmup: WARMUP_REQUESTS,
    bun: (Bun as any).version,
    os: process.platform,
  },
  scenarios: Object.fromEntries(
    Object.entries(allResults).map(([k, v]) => [
      k,
      v.map(({ name, result }) => ({ name, ...result })),
    ]),
  ),
};

const dir = join(import.meta.dir, 'results');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'latest.json'), JSON.stringify(output, null, 2));
console.log(`\n  Results saved → benchmarks/results/latest.json`);

console.log('\n  Done!\n');
process.exit(0);
