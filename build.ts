// Build script for FastAPI-TS
// Generates both ESM and CJS outputs

async function build() {
  console.log('🔨 Building FastAPI-TS...\n');

  // Build ESM
  console.log('📦 Building ESM...');
  const esmResult = await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist/esm',
    format: 'esm',
    target: 'bun',
    minify: false,
    sourcemap: 'external',
  });

  if (!esmResult.success) {
    console.error('❌ ESM build failed:');
    for (const log of esmResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  console.log('✅ ESM build complete\n');

  // Build CJS
  console.log('📦 Building CJS...');
  const cjsResult = await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist/cjs',
    format: 'cjs',
    target: 'node',
    minify: false,
    sourcemap: 'external',
  });

  if (!cjsResult.success) {
    console.error('❌ CJS build failed:');
    for (const log of cjsResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  console.log('✅ CJS build complete\n');

  // Generate TypeScript declarations
  console.log('📝 Generating type declarations...');
  const tscResult = Bun.spawnSync(['bun', 'x', 'tsc', '--project', 'tsconfig.build.json']);
  
  if (tscResult.exitCode !== 0) {
    console.error('❌ Type generation failed:');
    console.error(tscResult.stderr.toString());
    // Don't exit on type generation errors in development
    console.warn('⚠️  Continuing despite type generation errors...\n');
  } else {
    console.log('✅ Type declarations generated\n');
  }

  console.log('🎉 Build complete!');
}

build().catch(console.error);
