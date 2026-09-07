import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { rm, mkdir } from 'fs/promises';
import { spawnSync } from 'child_process';
import { detectRunner, describeRunner, resolveLocalTool, TOOL_ENTRIES, type Runner } from './runtime.js';

interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  outdir?: string;
  format?: 'esm' | 'cjs' | 'both';
  runtime?: 'auto' | 'bun' | 'node';
}

export function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build project for production')
    .option('-m, --minify', 'Minify output', false)
    .option('-s, --sourcemap', 'Generate sourcemaps', true)
    .option('-o, --outdir <dir>', 'Output directory', 'dist')
    .option('-f, --format <format>', 'Output format (esm, cjs, both) — Bun only', 'both')
    .option('-r, --runtime <runtime>', 'Runtime to use (auto, bun, node)', 'auto')
    .action(async (options: BuildOptions) => {
      await buildProject(options);
    });
}

async function buildProject(options: BuildOptions): Promise<void> {
  const entryPoint = join(process.cwd(), 'src', 'index.ts');

  // Check if entry point exists
  if (!existsSync(entryPoint)) {
    console.error('Error: src/index.ts not found');
    console.error('Make sure you are in a VeloceTS project directory');
    process.exit(1);
  }

  let runner: Runner;
  try {
    // `Bun.build` is an in-process API, so a `bun` binary on PATH is not enough.
    runner = detectRunner(options.runtime ?? 'auto', 'build', { inProcess: true });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const outdir = options.outdir || 'dist';

  console.log('Building project for production...');
  console.log(`Runtime: ${describeRunner(runner)}`);

  try {
    // Clean output directory
    if (existsSync(outdir)) {
      await rm(outdir, { recursive: true, force: true });
    }
    await mkdir(outdir, { recursive: true });

    if (runner === 'bun') {
      await buildWithBun(entryPoint, outdir, options);
    } else {
      buildWithTsc(outdir, options);
    }

    console.log('\n✓ Build completed successfully!');
    console.log(`\nOutput directory: ${outdir}`);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// ─── Bun ─────────────────────────────────────────────────────────────────────

async function buildWithBun(
  entryPoint: string,
  outdir: string,
  options: BuildOptions
): Promise<void> {
  const format = options.format || 'both';
  const formats = format === 'both' ? ['esm', 'cjs'] : [format];

  console.log(`Format: ${format}`);
  console.log(`Minify: ${options.minify ? 'yes' : 'no'}`);
  console.log(`Sourcemap: ${options.sourcemap !== false ? 'yes' : 'no'}`);

  for (const fmt of formats) {
    console.log(`\nBuilding ${fmt.toUpperCase()}...`);
    await buildFormat(entryPoint, outdir, fmt as 'esm' | 'cjs', options);
  }
}

async function buildFormat(
  entryPoint: string,
  outdir: string,
  format: 'esm' | 'cjs',
  options: BuildOptions
): Promise<void> {
  const outputDir = join(outdir, format);
  await mkdir(outputDir, { recursive: true });

  const buildResult = await Bun.build({
    entrypoints: [entryPoint],
    outdir: outputDir,
    target: 'bun',
    format: format === 'esm' ? 'esm' : 'cjs',
    minify: options.minify || false,
    sourcemap: options.sourcemap !== false ? 'external' : 'none',
    splitting: format === 'esm',
    external: [
      'hono',
      'zod',
      'reflect-metadata',
      'commander',
      'zod-to-json-schema',
    ],
  });

  if (!buildResult.success) {
    console.error(`Failed to build ${format}:`);
    for (const log of buildResult.logs) {
      console.error(log);
    }
    throw new Error(`Build failed for ${format}`);
  }

  console.log(`  ✓ ${format.toUpperCase()} build complete`);
  console.log(`    Files: ${buildResult.outputs.length}`);

  const totalSize = buildResult.outputs.reduce((sum, output) => sum + output.size, 0);
  console.log(`    Size: ${(totalSize / 1024).toFixed(2)} KB`);
}

// ─── Node ────────────────────────────────────────────────────────────────────

/**
 * Compile with the project's own `tsc`.
 *
 * `Bun.build` does not exist under Node, and a bundler is the wrong default here
 * anyway: `tsc` honours the project's `tsconfig.json`, which is what emits the
 * decorator metadata the framework relies on. Output layout therefore follows
 * `outDir`/`rootDir` rather than Bun's esm/cjs split.
 */
function buildWithTsc(outdir: string, options: BuildOptions): void {
  if (options.format && options.format !== 'both') {
    console.log(
      `Note: --format is a Bun-only option; the Node build emits whatever "module" your tsconfig.json sets.`
    );
  }

  const args = ['--outDir', outdir];
  if (options.sourcemap !== false) {
    args.push('--sourceMap');
  }

  const tsc = resolveLocalTool(TOOL_ENTRIES.tsc);
  if (!tsc) {
    throw new Error(
      'TypeScript is not installed in this project. Run: npm install -D typescript'
    );
  }

  console.log('\nCompiling with tsc...');

  const result = spawnSync(process.execPath, [tsc, ...args], {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`tsc exited with code ${result.status}`);
  }

  console.log('  ✓ TypeScript build complete');
}
