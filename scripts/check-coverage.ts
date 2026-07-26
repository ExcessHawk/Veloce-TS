#!/usr/bin/env bun
/**
 * Coverage gate — parses an lcov report and fails (exit 1) when the
 * project's line coverage over `src/` drops below a threshold.
 *
 * Why not just read bun's own console "All files" summary? Because that
 * total also includes `dist/**` (previously-built bundles left on disk),
 * `examples/**`, and the test files themselves, which massively dilutes
 * the number and makes it useless as a quality gate on the framework's
 * actual source. This script re-aggregates strictly the `src/` subset.
 *
 * Usage:
 *   bun run scripts/check-coverage.ts [--lcov <path>] [--threshold <percent>]
 *                                     [--exclude <path-prefix>]... [--include-optional-adapters]
 *
 * Exit code: 0 when coverage >= threshold, 1 otherwise (or on parse errors).
 */

interface FileCoverage {
  path: string;
  linesFound: number;
  linesHit: number;
}

interface CliOptions {
  lcovPath: string;
  threshold: number;
  excludePrefixes: string[];
}

/**
 * Excluded by default: adapter code for optional peer dependencies
 * (drizzle-orm / typeorm / prisma) that are NOT installed in the base test
 * matrix, so these files can only ever show near-zero coverage there —
 * counting them would gate the whole project on code the CI environment
 * structurally cannot exercise. Pass `--include-optional-adapters` to
 * measure them anyway (e.g. in a job that does install those peers).
 */
const DEFAULT_EXCLUDES = ['src/orm/drizzle/', 'src/orm/prisma/', 'src/orm/typeorm/'];

function parseArgs(argv: string[]): CliOptions {
  let lcovPath = 'coverage/lcov.info';
  // Set just below the measured baseline (~50%) so the gate is a ratchet:
  // it blocks regressions today instead of failing from day one, which would
  // train everyone to ignore it. Raise it as coverage climbs — the lowest
  // covered areas are printed on every run to show where to aim next.
  let threshold = 50;
  let excludePrefixes = [...DEFAULT_EXCLUDES];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lcov' && argv[i + 1]) {
      lcovPath = argv[++i];
    } else if (arg === '--threshold' && argv[i + 1]) {
      threshold = Number(argv[++i]);
    } else if (arg === '--exclude' && argv[i + 1]) {
      excludePrefixes.push(argv[++i]);
    } else if (arg === '--include-optional-adapters') {
      excludePrefixes = excludePrefixes.filter((p) => !DEFAULT_EXCLUDES.includes(p));
    }
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    console.error(`Invalid --threshold value: ${threshold}`);
    process.exit(1);
  }

  return { lcovPath, threshold, excludePrefixes };
}

/** Normalize Windows backslashes so path matching works on every OS. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Only count files that represent the framework's actual shipped source.
 * Excludes build output, examples, benchmarks, and the tests themselves —
 * their presence in bun's raw lcov output would otherwise dilute (or
 * inflate) the signal this gate is meant to provide — plus whatever
 * `excludePrefixes` the caller configured (see DEFAULT_EXCLUDES above).
 */
function isTrackedSourceFile(path: string, excludePrefixes: string[]): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith('src/')) return false;
  if (normalized.includes('/node_modules/')) return false;
  if (excludePrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
  return true;
}

/**
 * Minimal LCOV parser — only needs SF (source file) and LF/LH
 * (lines found / lines hit) per `end_of_record`-delimited section.
 */
function parseLcov(content: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let currentPath: string | null = null;
  let linesFound = 0;
  let linesHit = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      currentPath = line.slice('SF:'.length);
      linesFound = 0;
      linesHit = 0;
    } else if (line.startsWith('LF:')) {
      linesFound = Number(line.slice('LF:'.length)) || 0;
    } else if (line.startsWith('LH:')) {
      linesHit = Number(line.slice('LH:'.length)) || 0;
    } else if (line === 'end_of_record') {
      if (currentPath !== null) {
        files.push({ path: currentPath, linesFound, linesHit });
      }
      currentPath = null;
    }
  }

  return files;
}

async function main(): Promise<void> {
  const { lcovPath, threshold, excludePrefixes } = parseArgs(process.argv.slice(2));

  const file = Bun.file(lcovPath);
  if (!(await file.exists())) {
    console.error(`Coverage gate: lcov report not found at "${lcovPath}".`);
    console.error('Run `bun test --coverage --coverage-reporter=lcov` first.');
    process.exit(1);
  }

  const content = await file.text();
  const allFiles = parseLcov(content);

  if (allFiles.length === 0) {
    console.error(`Coverage gate: no records found in "${lcovPath}" — is the file empty/corrupt?`);
    process.exit(1);
  }

  const tracked = allFiles.filter((f) => isTrackedSourceFile(f.path, excludePrefixes));

  if (tracked.length === 0) {
    console.error('Coverage gate: no src/** files found in the lcov report.');
    console.error('Sample paths seen:', allFiles.slice(0, 5).map((f) => f.path));
    process.exit(1);
  }

  let totalFound = 0;
  let totalHit = 0;
  for (const f of tracked) {
    totalFound += f.linesFound;
    totalHit += f.linesHit;
  }

  const percent = totalFound === 0 ? 100 : (totalHit / totalFound) * 100;

  console.log(`Coverage gate — src/** line coverage: ${percent.toFixed(2)}% (${totalHit}/${totalFound} lines, ${tracked.length} files)`);
  console.log(`Threshold: ${threshold}%`);

  // Surface the worst-covered files to make failures actionable.
  const worst = [...tracked]
    .filter((f) => f.linesFound > 0)
    .sort((a, b) => a.linesHit / a.linesFound - b.linesHit / b.linesFound)
    .slice(0, 10);

  if (worst.length > 0) {
    console.log('\nLowest-covered src/** files:');
    for (const f of worst) {
      const pct = ((f.linesHit / f.linesFound) * 100).toFixed(1);
      console.log(`  ${pct.padStart(5)}%  ${normalizePath(f.path)}`);
    }
  }

  if (percent < threshold) {
    console.error(`\n❌ Coverage ${percent.toFixed(2)}% is below the ${threshold}% threshold.`);
    process.exit(1);
  }

  console.log(`\n✅ Coverage ${percent.toFixed(2)}% meets the ${threshold}% threshold.`);
}

main().catch((error) => {
  console.error('Coverage gate failed:', error);
  process.exit(1);
});
