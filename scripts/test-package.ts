#!/usr/bin/env bun
// Test script to verify package can be packed correctly
// Validates package structure and contents

import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── exports map validation ──────────────────────────────────────────────────

/**
 * Every condition (types/import/require/default) of every subpath in
 * package.json's "exports" map must resolve to a file that actually exists
 * in the built output. A stale/typo'd exports entry would otherwise only
 * surface when a consumer hits the missing subpath at runtime — this makes
 * it fail the build instead.
 *
 * Glob subpaths (e.g. "./adapters/*") are checked against the concrete
 * source files under src/adapters/*.ts, since each of those must have a
 * matching build output for the glob to resolve for real consumers.
 */
async function verifyExportsFilesExist(packageJson: any): Promise<void> {
  console.log('\n✅ Verifying exports map resolves to real files...');

  const exportsMap = packageJson.exports as Record<string, unknown> | undefined;
  if (!exportsMap) {
    throw new Error('package.json has no "exports" field');
  }

  let checked = 0;
  const missing: string[] = [];

  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath === './package.json') continue; // literal passthrough, not a code entry

    if (subpath.includes('*')) {
      await verifyGlobExport(subpath, target as Record<string, string>, missing);
      checked++;
      continue;
    }

    for (const [condition, relativePath] of flattenConditions(target)) {
      checked++;
      const abs = join(process.cwd(), relativePath);
      if (!existsSync(abs)) {
        missing.push(`"${subpath}".${condition} -> ${relativePath}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} exports entr${missing.length === 1 ? 'y' : 'ies'} point to missing files:\n  ` +
        missing.join('\n  ')
    );
  }

  console.log(`   ✓ All ${checked} exports condition(s) resolve to existing files`);
}

/**
 * Flatten an exports target into `[conditionPath, file]` pairs.
 *
 * Conditions nest: each of `import`/`require` carries its own `types` so that a
 * `require()` consumer is handed CommonJS declarations rather than the ESM tree.
 * A flat walk would hand `join()` an object and blow up.
 */
function flattenConditions(target: unknown, prefix = ''): Array<[string, string]> {
  if (typeof target === 'string') {
    return [[prefix || 'default', target]];
  }
  if (target && typeof target === 'object') {
    return Object.entries(target as Record<string, unknown>).flatMap(([condition, value]) =>
      flattenConditions(value, prefix ? `${prefix}.${condition}` : condition)
    );
  }
  return [];
}

/** The declaration file an ESM consumer resolves for a given exports target. */
function findEsmTypes(target: unknown): string | undefined {
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') return undefined;

  const entry = target as Record<string, unknown>;
  if (typeof entry.types === 'string') return entry.types;
  return findEsmTypes(entry.import ?? entry.default);
}

/**
 * For a glob subpath like "./adapters/*", derive the concrete basenames from
 * the matching src/ files (base.ts, hono.ts, express.ts, ...) and verify the
 * glob pattern in each condition expands to a real file for each of them.
 */
async function verifyGlobExport(
  subpath: string,
  conditions: unknown,
  missing: string[]
): Promise<void> {
  // "./adapters/*" -> src dir "adapters"
  const srcDir = subpath.replace(/^\.\//, '').replace(/\/\*$/, '');
  const srcGlob = new Bun.Glob('*.ts');
  const basenames: string[] = [];
  for await (const file of srcGlob.scan({ cwd: join(process.cwd(), 'src', srcDir) })) {
    basenames.push(file.replace(/\.ts$/, ''));
  }

  if (basenames.length === 0) {
    missing.push(`"${subpath}" — no matching source files under src/${srcDir}/*.ts to validate against`);
    return;
  }

  for (const [condition, patternPath] of flattenConditions(conditions)) {
    for (const basename of basenames) {
      const concretePath = patternPath.replace('*', basename);
      const abs = join(process.cwd(), concretePath);
      if (!existsSync(abs)) {
        missing.push(`"${subpath}".${condition} -> ${concretePath} (expanded from ${patternPath})`);
      }
    }
  }
}

// ── declaration/runtime module-kind agreement ────────────────────────────────

/**
 * The declarations a condition serves must describe the same module system the
 * runtime files use.
 *
 * TypeScript infers a `.d.ts` file's module kind from the nearest package.json.
 * The root declares `"type": "module"`, so a single shared declaration tree
 * reads as ESM everywhere — and a `require()` consumer on `moduleResolution:
 * node16` was told the package was ESM (TS1479) even though `require` resolves
 * to `dist/cjs`, which works fine at runtime. Types claiming one module system
 * while the runtime hands you another is the whole "masquerading" class of bug.
 */
async function verifyModuleKindMatchesRuntime(packageJson: any): Promise<void> {
  console.log('\n✅ Verifying declarations match the runtime module system...');

  const exportsMap = packageJson.exports as Record<string, any>;
  const problems: string[] = [];

  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath === './package.json' || typeof target === 'string') continue;

    for (const condition of ['import', 'require'] as const) {
      const entry = (target as Record<string, any>)[condition];
      if (!entry || typeof entry === 'string') continue;

      const typesPath: string | undefined = entry.types;
      if (!typesPath) {
        problems.push(`"${subpath}".${condition} has no "types"`);
        continue;
      }

      // dist/types -> ESM (inherits the root "type": "module")
      // dist/types-cjs -> CommonJS (carries its own marker)
      const declaresCjs = typesPath.includes('/types-cjs/');
      const wantsCjs = condition === 'require';
      if (declaresCjs !== wantsCjs) {
        problems.push(
          `"${subpath}".${condition} -> ${typesPath} describes ` +
          `${declaresCjs ? 'CommonJS' : 'ESM'} but the condition serves ` +
          `${wantsCjs ? 'CommonJS' : 'ESM'}`
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `${problems.length} exports condition(s) serve mismatched declarations:\n  ` +
        problems.join('\n  ')
    );
  }

  console.log('   ✓ Every import/require condition serves matching declarations');
}

// ── consumer type-check ──────────────────────────────────────────────────────

/**
 * Type-checks a throwaway file that imports the package's main entrypoints
 * straight from dist/types, the way a real consumer's compiler would resolve
 * them. Catches breakage that only "tsc --noEmit" over the framework's own
 * src/ would miss: declaration-emit bugs, subpaths that don't actually
 * export what package.json's exports map promises, cross-module type errors
 * that only appear once every public .d.ts is combined in one compile.
 */
async function verifyConsumerTypecheck(packageJson: any): Promise<void> {
  console.log('\n✅ Type-checking a consumer file against dist/types...');

  const tmpDir = join(process.cwd(), '.package-test-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const consumerFile = join(tmpDir, 'consumer.ts');

  try {
    const exportsMap = packageJson.exports as Record<string, any>;
    const lines: string[] = [];
    let importIndex = 0;

    for (const [subpath, target] of Object.entries(exportsMap)) {
      if (subpath === './package.json' || subpath.includes('*')) continue;
      // `types` now lives inside each condition (import/require), so pick the
      // ESM one; a flat `target.types` lookup silently matched nothing and
      // quietly shrank this check from 15 entrypoints to 3.
      const typesPath = findEsmTypes(target);
      if (!typesPath) continue;

      // '../dist/types/index' style relative import from .package-test-tmp/consumer.ts
      const relFromTmp = '../' + typesPath.replace(/^\.\//, '').replace(/\.d\.ts$/, '');
      lines.push(`import * as mod${importIndex} from '${relFromTmp}';`);
      lines.push(`export type Check${importIndex} = typeof mod${importIndex};`);
      importIndex++;
    }

    // Also exercise the concrete adapter subpaths behind the "./adapters/*" glob.
    for (const adapter of ['base', 'hono', 'express']) {
      lines.push(`import * as adapter_${adapter} from '../dist/types/adapters/${adapter}';`);
      lines.push(`export type CheckAdapter_${adapter} = typeof adapter_${adapter};`);
    }

    // A minimal real-world usage snippet, not just barrel imports — catches
    // cross-module type errors (e.g. a route handler's inferred types).
    lines.push(`
import { Veloce } from '../dist/types/index';
import { z } from 'zod';

const app = new Veloce({ title: 'consumer-check', version: '0.0.0' });
const BodySchema = z.object({ name: z.string() });
app.post('/items', {
  schema: { body: BodySchema },
  handler: async (c, body) => {
    return { name: body.name };
  },
});
`);

    writeFileSync(consumerFile, lines.join('\n'));

    const tscArgs = [
      'tsc',
      '--noEmit',
      '--strict',
      '--target', 'ES2022',
      '--module', 'ESNext',
      '--moduleResolution', 'bundler',
      '--skipLibCheck',
      '--experimentalDecorators',
      consumerFile,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = require('child_process').spawn('bunx', tscArgs, {
        cwd: process.cwd(),
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
      let output = '';
      child.stdout.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr.on('data', (d: Buffer) => (output += d.toString()));
      child.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Consumer type-check failed (tsc exit ${code}):\n${output}`));
        }
      });
      child.on('error', reject);
    });

    console.log(`   ✓ Consumer file (${importIndex + 3} entrypoints + a route handler) type-checks cleanly`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testPackage() {
  console.log('🧪 Testing package structure...\n');

  let tarballPath: string | undefined;

  try {
    // Verify dist directory exists
    console.log('📦 Verifying build output...');
    const distExists = existsSync(join(process.cwd(), 'dist'));
    if (!distExists) {
      console.log('⚠️  dist directory not found, building...');
      await execAsync('bun run build:prod', { cwd: process.cwd() });
    }
    
    // Verify required directories exist
    const requiredDirs = [
      'dist/esm',
      'dist/cjs',
      'dist/types',
    ];
    
    console.log('\n✅ Verifying required directories...');
    for (const dir of requiredDirs) {
      const dirPath = join(process.cwd(), dir);
      if (existsSync(dirPath)) {
        console.log(`   ✓ ${dir}`);
      } else {
        throw new Error(`Missing required directory: ${dir}`);
      }
    }
    
    // Verify required files exist
    const requiredFiles = [
      'package.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
    ];
    
    console.log('\n✅ Verifying required files...');
    for (const file of requiredFiles) {
      const filePath = join(process.cwd(), file);
      if (existsSync(filePath)) {
        console.log(`   ✓ ${file}`);
      } else {
        throw new Error(`Missing required file: ${file}`);
      }
    }
    
    // Actually pack the package
    console.log('\n📦 Creating actual package...');
    await execAsync('npm pack', { cwd: process.cwd() });
    
    // Find the packed tarball
    const packageJson = JSON.parse(
      await Bun.file(join(process.cwd(), 'package.json')).text()
    );
    const tarballName = `veloce-ts-${packageJson.version}.tgz`;
    tarballPath = join(process.cwd(), tarballName);

    if (!existsSync(tarballPath)) {
      throw new Error(`Tarball not found: ${tarballPath}`);
    }
    
    console.log(`✅ Package created: ${tarballName}`);
    
    // Get tarball size
    const stat = await Bun.file(tarballPath).stat();
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`📊 Package size: ${sizeMB} MB`);
    
    // Verify package.json exports
    console.log('\n✅ Verifying package.json exports...');
    const exports = packageJson.exports;
    if (exports) {
      console.log('   ✓ Main export');
      if (exports['./validation']) console.log('   ✓ validation export');
      if (exports['./middleware']) console.log('   ✓ middleware export');
      if (exports['./testing']) console.log('   ✓ testing export');
      if (exports['./errors']) console.log('   ✓ errors export');
      if (exports['./types']) console.log('   ✓ types export');
      if (exports['./docs']) console.log('   ✓ docs export');
      if (exports['./graphql']) console.log('   ✓ graphql export');
      if (exports['./websocket']) console.log('   ✓ websocket export');
      if (exports['./plugins']) console.log('   ✓ plugins export');
      if (exports['./cli']) console.log('   ✓ cli export');
    }
    
    // Verify types are included
    console.log('\n✅ Verifying TypeScript types...');
    if (packageJson.types) {
      console.log(`   ✓ Types entry: ${packageJson.types}`);
    }
    if (packageJson.exports['.'].types) {
      console.log(`   ✓ Types in exports: ${packageJson.exports['.'].types}`);
    }

    // Every exports subpath/condition must point at a file that really exists.
    await verifyExportsFilesExist(packageJson);

    // A real consumer file must type-check cleanly against dist/types.
    await verifyConsumerTypecheck(packageJson);

    await verifyModuleKindMatchesRuntime(packageJson);

    console.log('\n🎉 Package structure validation complete!');
    console.log('\n✅ Package can be packed successfully');
    console.log('✅ Required files included');
    console.log('✅ Source files excluded');
    console.log('✅ Exports configured correctly');
    console.log('✅ Exports resolve to real files');
    console.log('✅ TypeScript types included');
    console.log('✅ Consumer file type-checks against dist/types');
    console.log(`✅ Package size: ${sizeMB} MB`);

    console.log('\n📝 To test installation manually:');
    console.log(`   1. Create a test project`);
    console.log(`   2. Run: bun add ${tarballPath}`);
    console.log(`   3. Import: import { Veloce-TS } from 'veloce-ts'`);

  } catch (error) {
    console.error('\n❌ Package test failed:', error);
    throw error;
  } finally {
    // Always clean up the tarball, pass or fail — a failed run shouldn't
    // leave a stray .tgz sitting at the project root.
    if (tarballPath && existsSync(tarballPath)) {
      console.log(`\n🧹 Cleaning up: ${tarballPath}`);
      rmSync(tarballPath);
    }
  }
}

testPackage().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
