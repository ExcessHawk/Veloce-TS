/**
 * The CLI's version resolution.
 *
 * Both `veloce --version` and the dependency range written into a scaffolded
 * project come from here. They used to fall back to a hardcoded `'0.3.0'` — a
 * version that had not been current for a long time, and which `veloce new`
 * would have written straight into a new project's dependencies had the lookup
 * ever failed.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getFrameworkVersion, getScaffoldVersionRange } from '../src/cli/version';

const packageVersion = (
  JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8')) as { version: string }
).version;

describe('getFrameworkVersion', () => {
  it('reports the installed package version', () => {
    expect(getFrameworkVersion()).toBe(packageVersion);
  });

  it('never reports the old hardcoded fallback', () => {
    expect(getFrameworkVersion()).not.toBe('0.3.0');
  });

  it('is cached — repeated calls agree', () => {
    expect(getFrameworkVersion()).toBe(getFrameworkVersion());
  });
});

describe('getScaffoldVersionRange', () => {
  it('is a caret range on the installed version', () => {
    expect(getScaffoldVersionRange()).toBe(`^${packageVersion}`);
  });

  it('produces something npm can actually install', () => {
    const range = getScaffoldVersionRange();
    // 'unknown' would be written into a package.json and fail on install; the
    // helper answers 'latest' instead when the version cannot be determined.
    expect(range).not.toContain('unknown');
    expect(range === 'latest' || /^\^\d+\.\d+\.\d+/.test(range)).toBe(true);
  });
});
