import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { rm, mkdir } from 'fs/promises';

interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  outdir?: string;
  format?: 'esm' | 'cjs' | 'both';
}

export function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build project for production')
    .option('-m, --minify', 'Minify output', false)
    .option('-s, --sourcemap', 'Generate sourcemaps', true)
    .option('-o, --outdir <dir>', 'Output directory', 'dist')
    .option('-f, --format <format>', 'Output format (esm, cjs, both)', 'both')
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

  console.log('Building project for production...');
  console.log(`Format: ${options.format || 'both'}`);
  console.log(`Minify: ${options.minify ? 'yes' : 'no'}`);
  console.log(`Sourcemap: ${options.sourcemap ? 'yes' : 'no'}`);

  const outdir = options.outdir || 'dist';

  try {
    // Clean output directory
    if (existsSync(outdir)) {
      await rm(outdir, { recursive: true, force: true });
    }
    await mkdir(outdir, { recursive: true });

    const format = options.format || 'both';
    const formats = format === 'both' ? ['esm', 'cjs'] : [format];

    for (const fmt of formats) {
      console.log(`\nBuilding ${fmt.toUpperCase()}...`);
      await buildFormat(entryPoint, outdir, fmt as 'esm' | 'cjs', options);
    }

    console.log('\n✓ Build completed successfully!');
    console.log(`\nOutput directory: ${outdir}`);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
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
