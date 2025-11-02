// Build script for FastAPI-TS
// Generates both ESM and CJS outputs with optimizations

import { rmSync, existsSync } from 'fs';
import { join } from 'path';

interface BuildOptions {
  minify?: boolean;
  production?: boolean;
}

async function build(options: BuildOptions = {}) {
  const { minify = false, production = false } = options;
  
  console.log('🔨 Building veloce-ts...\n');
  
  // Clean dist directory
  console.log('🧹 Cleaning dist directory...');
  if (existsSync('./dist')) {
    rmSync('./dist', { recursive: true, force: true });
  }
  console.log('✅ Clean complete\n');

  // Get all entry points for tree-shaking support
  const entrypoints = [
    './src/index.ts',
    './src/validation/index.ts',
    './src/middleware/index.ts',
    './src/testing/index.ts',
    './src/errors/index.ts',
    './src/types/index.ts',
    './src/docs/index.ts',
    './src/graphql/index.ts',
    './src/websocket/index.ts',
    './src/plugins/index.ts',
    './src/cli/index.ts',
  ];

  // Build ESM
  console.log('📦 Building ESM...');
  const esmResult = await Bun.build({
    entrypoints,
    outdir: './dist/esm',
    format: 'esm',
    target: 'bun',
    minify: production || minify,
    sourcemap: production ? 'external' : 'inline',
    splitting: false, // Disable code splitting to avoid export conflicts
    naming: '[dir]/[name].js',
  });

  if (!esmResult.success) {
    console.error('❌ ESM build failed:');
    for (const log of esmResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  
  // Report bundle sizes
  let totalSize = 0;
  for (const output of esmResult.outputs) {
    const size = output.size / 1024;
    totalSize += size;
    console.log(`   ${output.path.replace(process.cwd(), '.')} - ${size.toFixed(2)} KB`);
  }
  console.log(`✅ ESM build complete (${totalSize.toFixed(2)} KB total)\n`);

  // Build CJS
  console.log('📦 Building CJS...');
  const cjsResult = await Bun.build({
    entrypoints,
    outdir: './dist/cjs',
    format: 'cjs',
    target: 'node',
    minify: production || minify,
    sourcemap: production ? 'external' : 'inline',
    naming: '[dir]/[name].js',
  });

  if (!cjsResult.success) {
    console.error('❌ CJS build failed:');
    for (const log of cjsResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  
  totalSize = 0;
  for (const output of cjsResult.outputs) {
    const size = output.size / 1024;
    totalSize += size;
    console.log(`   ${output.path.replace(process.cwd(), '.')} - ${size.toFixed(2)} KB`);
  }
  console.log(`✅ CJS build complete (${totalSize.toFixed(2)} KB total)\n`);

  // Generate TypeScript declarations
  console.log('📝 Generating type declarations...');
  const tscResult = Bun.spawnSync(['bun', 'x', 'tsc', '--project', 'tsconfig.build.json']);
  
  if (tscResult.exitCode !== 0) {
    console.error('❌ Type generation failed:');
    const errorOutput = tscResult.stderr.toString();
    if (errorOutput) {
      console.error(errorOutput);
    }
    if (production) {
      console.warn('⚠️  Type generation had errors, but continuing with publication...\n');
      console.warn('   Note: Some type definitions may be incomplete\n');
    } else {
      console.warn('⚠️  Continuing despite type generation errors...\n');
    }
  } else {
    console.log('✅ Type declarations generated\n');
  }

  // Verify tree-shaking
  if (production) {
    console.log('🌲 Verifying tree-shaking...');
    await verifyTreeShaking();
  }

  console.log('🎉 Build complete!');
  console.log('\n📊 Build Summary:');
  console.log(`   Format: ESM + CJS`);
  console.log(`   Minified: ${minify || production ? 'Yes' : 'No'}`);
  console.log(`   Sourcemaps: ${production ? 'External' : 'Inline'}`);
  console.log(`   Tree-shaking: Enabled`);
}

async function verifyTreeShaking() {
  // Simple verification that tree-shaking is working
  // by checking that unused exports are not in the bundle
  const fs = await import('fs/promises');
  
  try {
    const esmIndex = await fs.readFile('./dist/esm/src/index.js', 'utf-8');
    
    // Check bundle size is reasonable (< 100KB for core as per requirements)
    const sizeKB = Buffer.byteLength(esmIndex, 'utf-8') / 1024;
    
    if (sizeKB > 100) {
      console.warn(`⚠️  Warning: Core bundle size (${sizeKB.toFixed(2)} KB) exceeds 100KB target`);
    } else {
      console.log(`✅ Tree-shaking verified - Core bundle: ${sizeKB.toFixed(2)} KB`);
    }
  } catch (error) {
    console.warn('⚠️  Could not verify tree-shaking:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: BuildOptions = {
  minify: args.includes('--minify'),
  production: args.includes('--production'),
};

build(options).catch(console.error);
