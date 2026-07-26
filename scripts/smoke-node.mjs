#!/usr/bin/env node
/**
 * Node.js smoke test for the built package.
 *
 * Runs after `bun run build` (or `bun run build:prod`) under plain Node —
 * no Bun involved — to catch anything that only breaks for Node consumers
 * (missing Node-only shims, Bun-only globals leaking into the bundle, the
 * ESM/CJS dual-package hazard, etc). This is what CI's Node matrix job runs.
 *
 * Checks, for BOTH build artifacts:
 *   1. The main entrypoint loads and exports `Veloce`.
 *   2. A tiny app with one route compiles.
 *   3. `app.getHono().request('/')` returns the expected JSON body.
 *
 * The ESM artifact (dist/esm) is loaded via dynamic `import()` — this is
 * the real-world path for `import { Veloce } from 'veloce-ts'`.
 *
 * The CJS artifact (dist/cjs) is loaded via `createRequire()` rather than
 * `import()`. That's intentional, not a shortcut: this package's root
 * package.json declares `"type": "module"`, so Node's ESM loader would
 * try to parse the CJS bundle's `require`/`module.exports` syntax as ES
 * modules and fail. `createRequire()` uses Node's CommonJS loader, which
 * evaluates `.js` files as CommonJS regardless of the nearest
 * package.json's `"type"` — the same path a real `require('veloce-ts')`
 * consumer goes through — and is therefore the correct way to exercise
 * the CJS artifact from an `.mjs` script.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    console.error(`  NOT ok - ${label}`);
    failures++;
  }
}

async function exerciseApp(Veloce, label) {
  check(`${label}: Veloce is exported as a class`, typeof Veloce === 'function');

  const app = new Veloce({ title: 'Smoke', version: '0.0.0' });
  app.get('/', {
    handler: async () => ({ ok: true, runtime: label }),
  });
  await app.compile();

  const response = await app.getHono().request('/');
  check(`${label}: GET / responds 200`, response.status === 200);

  const body = await response.json();
  check(`${label}: GET / body.ok === true`, body?.ok === true);
  check(`${label}: GET / body.runtime === '${label}'`, body?.runtime === label);
}

async function smokeEsm() {
  console.log('== dist/esm (dynamic import) ==');
  const esmEntry = join(root, 'dist', 'esm', 'src', 'index.js');
  const mod = await import(pathToFileUrl(esmEntry));
  await exerciseApp(mod.Veloce, 'node-esm');
}

async function smokeCjs() {
  console.log('== dist/cjs (createRequire) ==');
  const cjsEntry = join(root, 'dist', 'cjs', 'src', 'index.js');
  const mod = require(cjsEntry);
  await exerciseApp(mod.Veloce, 'node-cjs');
}

function pathToFileUrl(p) {
  // Dynamic import() needs a valid module specifier — an absolute Windows
  // path like "C:\foo\bar.js" is not one, so always go through a file:// URL.
  return new URL('file://' + p.replace(/\\/g, '/').replace(/^([A-Za-z]:)/, '/$1'));
}

async function main() {
  await smokeEsm();
  await smokeCjs();

  if (failures > 0) {
    console.error(`\n${failures} smoke check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAll smoke checks passed.');
}

main()
  .catch((error) => {
    console.error('Smoke test crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Some transports/timers created by a compiled app are not always
    // unref'd, which would otherwise keep the CI job hanging after the
    // checks above have already run to completion.
    process.exit(process.exitCode ?? 0);
  });
