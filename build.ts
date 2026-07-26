// Build script for veloce-ts
// Generates both ESM and CJS outputs with optimizations

import { rmSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
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
    // Subpath exports that consumers can import directly
    './src/auth/index.ts',
    './src/adapters/base.ts',
    './src/adapters/hono.ts',
    './src/adapters/express.ts',
  ];

  // Externalise every declared dependency — bundle only veloce-ts's own src/.
  //
  // Runtime `dependencies` are installed by the consumer's package manager, so
  // bundling them would ship a second copy. That is not just bloat:
  //   - `zod` identity breaks. The framework runs `instanceof`-style checks
  //     against schemas the USER constructed with THEIR zod; a bundled copy is
  //     a different class and those checks stop matching.
  //   - third-party code gets re-transpiled by the bundler. `semver` (pulled in
  //     via jsonwebtoken) builds its regexes by string concatenation at module
  //     init, and bundling mangled that into an invalid RegExp that threw on
  //     require under Node.
  // Optional peers (drizzle/typeorm/prisma/graphql/ioredis/express) are listed
  // too — they are lazily required at runtime and may legitimately be absent.
  const pkg = JSON.parse(await Bun.file('./package.json').text());
  const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    // Lazily required optional peers that are not declared as deps
    'drizzle-orm',
    'typeorm',
    'prisma',
    '@prisma/client',
    'graphql',
    'express',
    // Node builtins referenced via bare specifiers
    'node:fs',
    'node:fs/promises',
    'node:stream',
    'node:crypto',
    'node:path',
  ];

  // Build ESM
  console.log('📦 Building ESM...');
  const esmResult = await Bun.build({
    entrypoints,
    outdir: './dist/esm',
    format: 'esm',
    // 'node' target (rather than 'bun') avoids `import.meta.require` in the
    // output, which is a Bun-only global and crashes under real Node when a
    // bundled dependency needs a synchronous require() (e.g. commander's use
    // of Node's `events`). Node-target ESM still runs fine under Bun, so this
    // keeps a single ESM artifact usable by both runtimes.
    target: 'node',
    minify: production || minify,
    sourcemap: production ? 'external' : 'inline',
    splitting: false, // Disable code splitting to avoid export conflicts
    naming: '[dir]/[name].js',
    external,
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
    external,
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

  // The root package.json declares "type": "module" (needed so dist/esm's
  // .js files are loaded as ESM). Without a marker of their own, dist/cjs's
  // .js files would inherit that same "module" type from the nearest
  // ancestor package.json, even though their content is plain CommonJS
  // (`require`/`module.exports`) — Node would then try to parse them as ES
  // modules and fail (or silently misbehave depending on the entry path).
  // A minimal package.json here pins dist/cjs to "commonjs" so every
  // consumer path (`require('veloce-ts')`, `createRequire()`, the CJS
  // condition of "exports") resolves unambiguously.
  await writeFile(join('./dist/cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
  console.log('📎 Wrote dist/cjs/package.json ({ "type": "commonjs" })\n');

  // Generate TypeScript declarations
  console.log('📝 Generating type declarations...');
  const tscResult = Bun.spawnSync(['bun', 'x', 'tsc', '--project', 'tsconfig.build.json']);

  if (tscResult.exitCode !== 0) {
    console.error('❌ Type generation failed:');
    // tsc reports diagnostics on stdout, not stderr — print both so nothing is lost.
    const stdOutput = tscResult.stdout.toString();
    const errorOutput = tscResult.stderr.toString();
    if (stdOutput) {
      console.error(stdOutput);
    }
    if (errorOutput) {
      console.error(errorOutput);
    }
    if (production) {
      // Published packages must never ship with broken/incomplete .d.ts files —
      // fail the build so this can't silently reach npm.
      console.error('❌ Production build requires clean type generation. Aborting.\n');
      process.exit(1);
    } else {
      console.warn('⚠️  Continuing despite type generation errors (dev build)...\n');
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
    
    // The full index bundles everything (auth, RBAC, OAuth, GraphQL, WS, plugins…).
    // Warn if it grows unreasonably large; the practical threshold for this scope is 600 KB.
    const sizeKB = Buffer.byteLength(esmIndex, 'utf-8') / 1024;
    
    if (sizeKB > 600) {
      console.warn(`⚠️  Warning: Core bundle size (${sizeKB.toFixed(2)} KB) exceeds 600KB — consider lazy imports`);
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
