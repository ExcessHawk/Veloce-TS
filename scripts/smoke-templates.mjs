#!/usr/bin/env node
/**
 * Scaffold every `veloce new` template and prove it works — under plain Node.
 *
 * Written after 3.0.1 shipped a CLI whose own templates produced an app that
 * crashed on startup (a CORS config the framework had begun rejecting), plus a
 * `build` command that threw `ReferenceError: Bun is not defined` and emitted
 * imports Node's ESM loader could not resolve. None of that was caught, because
 * nothing ever ran the generated output.
 *
 * For each template this:
 *   1. scaffolds it with the local CLI,
 *   2. repoints the `veloce-ts` dependency at a freshly packed tarball of THIS
 *      checkout — otherwise npm installs the last published release and the test
 *      says nothing about the code under review,
 *   3. installs, type-checks and builds it,
 *   4. boots the built output and asserts it answers a real request.
 *
 * Step 4 is skipped for templates that need a WebSocket upgrade: `WebSocketPlugin`
 * throws on Node by design (Bun/Deno only). Those are still built, so a broken
 * template is caught even where it cannot run.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'bin', 'veloce.mjs');

/** `boots: false` — needs a WebSocket upgrade, which Node does not support yet. */
const TEMPLATES = [
  { name: 'rest', boots: true, path: '/users' },
  { name: 'graphql', boots: true, path: '/graphql' },
  { name: 'websocket', boots: false },
  { name: 'fullstack', boots: false },
];

const BOOT_TIMEOUT_MS = 30_000;
const failures = [];

/**
 * @param shell - needed for npm on Windows, where it is an `npm.cmd` shim that
 *   Node refuses to spawn directly. Only ever used with hardcoded arguments, so
 *   the shell's lack of argument escaping cannot bite here.
 */
function run(command, args, cwd, label, shell = false) {
  try {
    execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf-8', shell });
    return null;
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message;
    return `${label} failed\n${output.split('\n').slice(0, 12).join('\n')}`;
  }
}

const NEEDS_SHELL = process.platform === 'win32';

/** Pack the working tree so the templates test this code, not the npm release. */
function packFramework() {
  console.log('Packing the local framework...');
  const out = execFileSync('npm', ['pack', '--silent', '--pack-destination', tmpdir()], {
    cwd: REPO,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  const tarball = join(tmpdir(), out.trim().split('\n').pop().trim());
  if (!existsSync(tarball)) {
    throw new Error(`npm pack did not produce a tarball (looked for ${tarball})`);
  }
  console.log(`  ${tarball}\n`);
  return tarball;
}

function useLocalFramework(projectDir, tarball) {
  const pkgPath = join(projectDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.dependencies['veloce-ts'] = `file:${tarball}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
}

/**
 * Start the built app and wait until it answers, or give up.
 *
 * The templates call `app.listen(3000)` with a literal, so there is nothing to
 * override with PORT — the checks run one at a time for that reason.
 */
async function boots(projectDir, path) {
  const port = 3000;
  const child = spawn(process.execPath, [join(projectDir, 'dist', 'index.js')], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        return `process exited early (code ${child.exitCode})\n${output.split('\n').slice(0, 10).join('\n')}`;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        // Any non-5xx means the app booted and routed the request.
        if (res.status < 500) return null;
        return `${path} answered ${res.status}`;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return `did not answer ${path} within ${BOOT_TIMEOUT_MS}ms\n${output.split('\n').slice(0, 10).join('\n')}`;
  } finally {
    child.kill('SIGKILL');
  }
}

async function checkTemplate(template, workdir, tarball) {
  const name = `app-${template.name}`;
  const dir = join(workdir, name);
  console.log(`── ${template.name} ${'─'.repeat(Math.max(0, 40 - template.name.length))}`);

  let error = run(process.execPath, [CLI, 'new', name, '--template', template.name], workdir, 'scaffold');
  if (error) return error;

  useLocalFramework(dir, tarball);

  error = run('npm', ['install', '--no-audit', '--no-fund', '--silent'], dir, 'npm install', NEEDS_SHELL);
  if (error) return error;
  console.log('  ok   - installed');

  const tsc = join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
  error = run(process.execPath, [tsc, '--noEmit'], dir, 'type-check');
  if (error) return error;
  console.log('  ok   - type-checks');

  error = run(process.execPath, [CLI, 'build', '--runtime', 'node'], dir, 'build');
  if (error) return error;
  console.log('  ok   - builds under Node');

  if (!template.boots) {
    console.log('  skip - boot (needs a WebSocket upgrade; Bun/Deno only)');
    return null;
  }

  const bootError = await boots(dir, template.path);
  if (bootError) return `boot failed\n${bootError}`;
  console.log(`  ok   - serves ${template.path}`);
  return null;
}

async function main() {
  const tarball = packFramework();
  const workdir = mkdtempSync(join(tmpdir(), 'veloce-templates-'));

  try {
    for (const template of TEMPLATES) {
      const error = await checkTemplate(template, workdir, tarball);
      if (error) {
        failures.push(`[${template.name}] ${error}`);
        console.log(`  FAIL - ${error.split('\n')[0]}`);
      }
      console.log('');
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(tarball, { force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} template check(s) failed:\n`);
    for (const failure of failures) console.error(`${failure}\n`);
    process.exit(1);
  }

  console.log('All templates scaffold, type-check, build and run under Node.');
}

main().catch((error) => {
  console.error('Template smoke test crashed:', error);
  process.exit(1);
});
