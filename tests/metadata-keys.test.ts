/**
 * Metadata keys must survive two copies of the framework in one process.
 *
 * The package ships a bundle per subpath, so `veloce-ts` and `veloce-ts/plugins`
 * are distinct modules under CommonJS. With plain `Symbol()` keys the two copies
 * disagreed, and a class decorated through one specifier was invisible to code
 * loaded through the other — silently. What it looked like in practice: a
 * GraphQL schema with no fields, whose first query died on `buildSchema('')`
 * with "Syntax Error: Unexpected <EOF>".
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import 'reflect-metadata';

const SRC = join(import.meta.dir, '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('metadata key symbols', () => {
  const files = sourceFiles(SRC);

  it('are all created through the global registry', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const line of text.split('\n')) {
        // Only assignments; the examples inside JSDoc are the user's own tokens.
        if (/=\s*Symbol\('/.test(line)) {
          offenders.push(`${file.replace(SRC, 'src')}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('are namespaced, so they cannot collide with another package', () => {
    const keys: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(/=\s*Symbol\.for\('([^']+)'\)/g)) {
        keys.push(match[1]);
      }
    }

    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(key.startsWith('veloce-ts:')).toBe(true);
    }
  });

  it('resolve to the same symbol from anywhere in the process', () => {
    // What `Symbol.for` buys: a second copy of the framework computing the key
    // independently lands on the identical symbol.
    const here = Symbol.for('veloce-ts:graphql:resolver');
    const asIfAnotherCopy = Symbol.for('veloce-ts:graphql:resolver');
    expect(here).toBe(asIfAnotherCopy);
    // A plain Symbol with the same description would not.
    expect(Symbol('veloce-ts:graphql:resolver')).not.toBe(here);
  });

  it('lets a second copy read metadata the first one wrote', () => {
    class Target {}

    // Copy A writes with its own computed key...
    Reflect.defineMetadata(Symbol.for('veloce-ts:graphql:resolver'), { name: 'A' }, Target);
    // ...copy B reads with its own.
    const seen = Reflect.getMetadata(Symbol.for('veloce-ts:graphql:resolver'), Target);

    expect(seen).toEqual({ name: 'A' });
  });
});
