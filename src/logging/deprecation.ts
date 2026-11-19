/**
 * @module veloce-ts/logging/deprecation
 * @description One-time notices about behavior that changes in a future major version.
 */
import { getLogger } from './logger.js';

const emitted = new Set<string>();

/**
 * Log a deprecation notice once per process.
 *
 * @param code - Stable identifier of the notice (also what silences it)
 * @param message - What changes, and what to write to keep or adopt the behavior
 *
 * Set `VELOCE_NO_DEPRECATION=1` to silence every notice, or a comma-separated
 * list of codes to silence only those.
 */
export function deprecate(code: string, message: string): void {
  if (emitted.has(code)) return;
  emitted.add(code);

  const silenced = typeof process !== 'undefined' ? process.env?.VELOCE_NO_DEPRECATION : undefined;
  if (silenced) {
    if (silenced === '1' || silenced === 'true') return;
    if (silenced.split(',').map((s) => s.trim()).includes(code)) return;
  }

  const text = `[veloce-ts deprecation ${code}] ${message}`;
  try {
    getLogger().warn(text);
  } catch {
    console.warn(text);
  }
}

/** @internal Forget which notices were emitted (tests). */
export function resetDeprecations(): void {
  emitted.clear();
}
