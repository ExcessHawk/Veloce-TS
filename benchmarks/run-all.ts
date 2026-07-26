/**
 * Thin delegator to run.ts.
 *
 * This used to be a second, divergent benchmark harness: it only compared
 * veloce-ts and Hono (not Express/Fastify like run.ts), depended on the
 * external `autocannon` CLI being installed globally, and its results
 * disagreed with run.ts's in-process numbers because the two measured
 * different things under different load generators. Keeping both alive was
 * how BENCHMARKS.md ended up citing numbers that contradicted
 * results/latest.json. There is now a single harness (run.ts); this file
 * stays only so `bun run benchmarks/run-all.ts` (muscle memory, old docs)
 * keeps working.
 */
import { spawnSync } from 'child_process';
import { join } from 'path';

const result = spawnSync('bun', ['run', join(import.meta.dir, 'run.ts'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
