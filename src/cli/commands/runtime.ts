/**
 * @module veloce-ts/cli/commands/runtime
 * @description Runtime detection shared by `veloce dev` and `veloce build`.
 *
 * The framework supports Bun and Node, but the CLI used to hardcode Bun: `dev`
 * spawned `bun` unconditionally and `build` called `Bun.build`, which is simply
 * undefined under Node. These helpers pick a runner instead.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export type Runner = 'bun' | 'node';
export type RuntimePreference = 'auto' | 'bun' | 'node';

/** Whether the process currently executing the CLI is Bun. */
export function runningUnderBun(): boolean {
  return typeof (globalThis as any).Bun !== 'undefined';
}

/**
 * Whether a `bun` executable is reachable on PATH. The CLI itself may be running
 * under Node (via `bin/veloce.mjs`) while Bun is still installed.
 */
export function bunAvailable(): boolean {
  if (runningUnderBun()) return true;
  try {
    const probe = spawnSync('bun', ['--version'], {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    return probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve which runner to use.
 *
 * @param preference - `auto` prefers Bun when available, otherwise Node
 * @param command - the command asking, used only for error messages
 * @param options.inProcess - the caller needs Bun's *in-process* API (`Bun.build`),
 *   not merely a `bun` binary it can spawn. Having Bun installed is not enough
 *   there: when the CLI itself is started by Node, `Bun` is undefined no matter
 *   what is on PATH.
 * @throws when the caller explicitly asked for Bun and it is unavailable
 */
export function detectRunner(
  preference: RuntimePreference,
  command: string,
  options: { inProcess?: boolean } = {}
): Runner {
  const bunUsable = options.inProcess ? runningUnderBun() : bunAvailable();

  if (preference === 'bun') {
    if (!bunUsable) {
      throw new Error(
        options.inProcess
          ? `veloce ${command}: --runtime bun needs the CLI itself to run under Bun ` +
            `(this process is Node).\nRun it with "bun run veloce ${command}", or use --runtime node.`
          : `veloce ${command}: --runtime bun was requested but no "bun" executable was found on PATH.\n` +
            'Install Bun from https://bun.sh, or use --runtime node.'
      );
    }
    return 'bun';
  }

  if (preference === 'node') {
    return 'node';
  }

  if (preference !== 'auto') {
    throw new Error(
      `veloce ${command}: unknown --runtime "${preference}". Use auto, bun or node.`
    );
  }

  return bunUsable ? 'bun' : 'node';
}

/** Human-readable runner label for CLI output. */
export function describeRunner(runner: Runner): string {
  return runner === 'bun' ? 'Bun' : 'Node.js (tsx)';
}

/**
 * Locate a locally installed tool's JavaScript entry point.
 *
 * Deliberately avoids the `.bin` shims and `npx`. On Windows those are `.cmd`
 * files, and since the fix for CVE-2024-27980 Node refuses to `spawn` a `.cmd`
 * without `shell: true` (EINVAL). Turning the shell on would work but
 * concatenates arguments instead of escaping them — Node reports that as
 * DEP0190 — and project paths here routinely contain spaces.
 *
 * Running the tool's own `.js`/`.mjs` entry with `process.execPath` sidesteps
 * both problems and works identically on every platform.
 *
 * @returns the absolute path, or `null` when the package is not installed
 */
export function resolveLocalTool(candidates: Array<[pkg: string, entry: string]>): string | null {
  for (const [pkg, entry] of candidates) {
    const resolved = join(process.cwd(), 'node_modules', pkg, entry);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

/** Entry points for the tools the Node path shells out to. */
export const TOOL_ENTRIES = {
  tsc: [['typescript', join('bin', 'tsc')]] as Array<[string, string]>,
  tsx: [
    ['tsx', join('dist', 'cli.mjs')],
    ['tsx', join('dist', 'cli.js')],
  ] as Array<[string, string]>,
};
