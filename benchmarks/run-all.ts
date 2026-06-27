import { spawn, spawnSync } from 'child_process';
import { join } from 'path';

interface BenchResult {
  framework: string;
  route: string;
  rps: number;
  latencyP99Ms: number;
  errors: number;
}

const DURATION = 10; // seconds
const CONNECTIONS = 100;
const BASE = join(import.meta.dir, 'servers');

const servers: Array<{ name: string; file: string; port: number }> = [
  { name: 'veloce-ts', file: join(BASE, 'veloce.ts'), port: 3000 },
  { name: 'hono',      file: join(BASE, 'hono.ts'),   port: 3001 },
];

const routes = ['/hello', '/json', '/params/test-id'];

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function benchmark(url: string): Promise<{ rps: number; p99: number; errors: number }> {
  return new Promise((resolve) => {
    const proc = spawnSync('autocannon', [
      '-c', String(CONNECTIONS),
      '-d', String(DURATION),
      '--json',
      url,
    ], { encoding: 'utf8' });

    try {
      const result = JSON.parse(proc.stdout);
      resolve({
        rps: Math.round(result.requests?.mean ?? 0),
        p99: result.latency?.p99 ?? 0,
        errors: result.errors ?? 0,
      });
    } catch {
      resolve({ rps: 0, p99: 0, errors: 1 });
    }
  });
}

const results: BenchResult[] = [];

console.log('Starting veloce-ts benchmark suite\n');
console.log(`Config: ${CONNECTIONS} connections, ${DURATION}s per route\n`);

for (const server of servers) {
  console.log(`Starting ${server.name}...`);
  const proc = spawn('bun', [server.file], { stdio: 'pipe' });
  await sleep(1500); // warm up

  for (const route of routes) {
    const url = `http://localhost:${server.port}${route}`;
    process.stdout.write(`  Benchmarking ${route}... `);
    const { rps, p99, errors } = await benchmark(url);
    console.log(`${rps.toLocaleString()} req/s  p99=${p99}ms  errors=${errors}`);
    results.push({ framework: server.name, route, rps, latencyP99Ms: p99, errors });
  }

  proc.kill();
  await sleep(500);
  console.log();
}

// Print comparison table
console.log('\n=== RESULTS ===\n');
console.log('Route'.padEnd(20), ...servers.map(s => s.name.padEnd(20)));
console.log('-'.repeat(20 + servers.length * 20));

for (const route of routes) {
  const row = servers.map(s => {
    const r = results.find(x => x.framework === s.name && x.route === route);
    return r ? `${r.rps.toLocaleString()} req/s`.padEnd(20) : 'N/A'.padEnd(20);
  });
  console.log(route.padEnd(20), ...row);
}

console.log('\nDone. Run individual servers to drill down on specific routes.');
