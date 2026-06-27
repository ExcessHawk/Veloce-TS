import { VeloceTS } from '../core/application';

/**
 * Resets stateful singletons that leak between tests in the same Bun process.
 * Call in beforeEach() when multiple test files share the same worker.
 */
export async function isolate(app?: VeloceTS): Promise<void> {
  try {
    const { CacheManager } = await import('../cache/manager');
    if (typeof (CacheManager as any).reset === 'function') {
      (CacheManager as any).reset();
    }
  } catch { /* CacheManager not available in this build */ }

  // app arg is a hook for future per-app reset logic; kept for API stability
  void app;
}

/**
 * Compiles the app and returns the underlying Hono instance.
 * Convenience for the common `await app.compile(); app.getHono()` test pattern.
 */
export async function compileTestApp(app: VeloceTS) {
  await app.compile();
  return app.getHono();
}
