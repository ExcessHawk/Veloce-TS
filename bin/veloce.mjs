#!/usr/bin/env node
/**
 * @module veloce-ts/bin/veloce
 * @description Node-compatible launcher for the `veloce` / `veloce-ts` CLI.
 *
 * This file is intentionally plain ESM (`.mjs`) with no build step of its own,
 * so it works even before/without a local `tsc` install. It just picks the
 * right pre-built CLI bundle and imports it:
 *
 *  - Under Bun: import the CJS bundle directly (identical to the legacy
 *    `bin/veloce.ts` entry point) — a trivial fast path that avoids any
 *    ESM/CJS interop subtlety since Bun sniffs module format at load time.
 *  - Under Node: import the ESM bundle. `build.ts` compiles `dist/esm` with
 *    `target: 'node'` specifically so this bundle has no Bun-only globals
 *    (e.g. `import.meta.require`) and runs under real Node.
 *
 * Both bundles register the same Commander program and call `program.parse()`
 * as a side effect of being imported, so this launcher only needs to pick the
 * right file and `import()` it.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a path relative to the package root and turn it into a proper
 * `file://` URL — required for `import()` to work with absolute Windows
 * paths (which are not valid ESM specifiers as raw strings).
 */
function packageFileUrl(...segments) {
  return pathToFileURL(join(__dirname, '..', ...segments)).href;
}

const isBun = typeof globalThis.Bun !== 'undefined';

try {
  if (isBun) {
    await import(packageFileUrl('dist', 'cjs', 'src', 'cli', 'index.js'));
  } else {
    await import(packageFileUrl('dist', 'esm', 'src', 'cli', 'index.js'));
  }
} catch (error) {
  console.error('Failed to start the veloce-ts CLI.');
  console.error('Make sure the package was built (dist/ present).');
  console.error(error);
  process.exit(1);
}
