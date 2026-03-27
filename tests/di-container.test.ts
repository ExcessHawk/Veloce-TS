/**
 * Dependency Injection container tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { DIContainer } from '../src/dependencies/container';

class ServiceA {
  value = 'A';
}

class ServiceB {
  value = 'B';
}

describe('DIContainer', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  // ─── Singleton ────────────────────────────────────────────────────────────

  it('singleton returns same instance on every resolve', async () => {
    container.register(ServiceA, { scope: 'singleton' });
    const a1 = await container.resolve(ServiceA);
    const a2 = await container.resolve(ServiceA);
    expect(a1).toBe(a2);
  });

  it('singleton is cached — stats reflect hit after first miss', async () => {
    container.register(ServiceA, { scope: 'singleton' });
    await container.resolve(ServiceA);
    await container.resolve(ServiceA);
    const stats = container.getStats();
    expect(stats.singletonHits).toBeGreaterThanOrEqual(1);
  });

  // ─── Transient ────────────────────────────────────────────────────────────

  it('transient returns a new instance every time', async () => {
    container.register(ServiceA, { scope: 'transient' });
    const a1 = await container.resolve(ServiceA);
    const a2 = await container.resolve(ServiceA);
    // Different object references
    expect(a1).not.toBe(a2);
  });

  // ─── Factory ──────────────────────────────────────────────────────────────

  it('custom factory is used when provided', async () => {
    const myInstance = new ServiceA();
    myInstance.value = 'custom';

    container.register(ServiceA, {
      scope: 'singleton',
      factory: () => myInstance,
    });
    const resolved = await container.resolve(ServiceA);
    expect(resolved.value).toBe('custom');
    expect(resolved).toBe(myInstance);
  });

  // ─── Request scope ────────────────────────────────────────────────────────

  it('request scope with same context returns same instance', async () => {
    container.register(ServiceA, { scope: 'request' });
    const fakeContext = {} as any;
    const a1 = await container.resolve(ServiceA, { scope: 'request', context: fakeContext });
    const a2 = await container.resolve(ServiceA, { scope: 'request', context: fakeContext });
    expect(a1).toBe(a2);
  });

  it('request scope without context throws', async () => {
    container.register(ServiceA, { scope: 'request' });
    await expect(container.resolve(ServiceA, { scope: 'request' })).rejects.toThrow(
      'Cannot resolve request-scoped provider'
    );
  });

  it('request scope with different contexts returns different instances', async () => {
    container.register(ServiceA, { scope: 'request' });
    const ctx1 = {} as any;
    const ctx2 = {} as any;
    const a1 = await container.resolve(ServiceA, { scope: 'request', context: ctx1 });
    const a2 = await container.resolve(ServiceA, { scope: 'request', context: ctx2 });
    expect(a1).not.toBe(a2);
  });

  // ─── Circular dependency detection ───────────────────────────────────────

  it('detects circular dependency', async () => {
    // Create a factory that tries to resolve itself (circular)
    let resolutionCount = 0;
    container.register(ServiceA, {
      scope: 'transient',
      factory: async () => {
        resolutionCount++;
        if (resolutionCount === 1) {
          await container.resolve(ServiceA); // triggers circular
        }
        return new ServiceA();
      },
    });
    await expect(container.resolve(ServiceA)).rejects.toThrow('Circular dependency detected');
  });

  // ─── Clear ────────────────────────────────────────────────────────────────

  it('clear() removes all singletons — next resolve creates a fresh instance', async () => {
    container.register(ServiceA, { scope: 'singleton' });
    const a1 = await container.resolve(ServiceA);
    container.clear();
    container.register(ServiceA, { scope: 'singleton' });
    const a2 = await container.resolve(ServiceA);
    expect(a1).not.toBe(a2);
  });

  // ─── Stats ────────────────────────────────────────────────────────────────

  it('getStats() returns numeric fields', async () => {
    const stats = container.getStats();
    expect(typeof stats.singletonHits).toBe('number');
    expect(typeof stats.transientCreations).toBe('number');
    expect(typeof stats.singletonHitRate).toBe('number');
  });
});
