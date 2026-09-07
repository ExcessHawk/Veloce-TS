/**
 * @module veloce-ts/cli/version
 * @description Resolves the version of the veloce-ts install running the CLI.
 *
 * Shared by `veloce --version` and by `veloce new`, which needs a real version
 * to write into the scaffolded `package.json`. Both previously fell back to a
 * hardcoded `'0.3.0'` — a version that has not been current since long before
 * this file existed, and which would have been written straight into a new
 * project's dependencies had the lookup ever failed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/** Used when the package.json genuinely cannot be read; never written to a file. */
const UNKNOWN_VERSION = 'unknown';

let cached: string | null = null;

/**
 * The installed framework's version, read from its own package.json.
 *
 * @returns the version, or `'unknown'` if it cannot be determined
 */
export function getFrameworkVersion(): string {
  if (cached !== null) return cached;

  try {
    // dist/{esm,cjs}/src/cli/ -> package root is four levels up; the bundler
    // shims __dirname in both outputs.
    const packagePath = join(__dirname, '..', '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: string };
    if (pkg.version) {
      cached = pkg.version;
      return cached;
    }
  } catch {
    // fall through
  }

  // Running from source (bun src/cli/index.ts) puts the root two levels up.
  try {
    const packagePath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: string };
    if (pkg.version) {
      cached = pkg.version;
      return cached;
    }
  } catch {
    // fall through
  }

  cached = UNKNOWN_VERSION;
  return cached;
}

/**
 * A version range safe to write into a generated `package.json`.
 *
 * Falls back to the latest published major line rather than `unknown`, which is
 * not installable.
 */
export function getScaffoldVersionRange(): string {
  const version = getFrameworkVersion();
  return version === UNKNOWN_VERSION ? 'latest' : `^${version}`;
}
