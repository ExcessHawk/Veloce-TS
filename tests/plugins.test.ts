/**
 * Plugin system tests — PluginManager registration, dependency resolution, install order
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { PluginManager } from '../src/core/plugin';
import type { Plugin } from '../src/core/plugin';

function makePlugin(name: string, deps?: string[], onInstall?: () => void): Plugin {
  return {
    name,
    dependencies: deps,
    install: async (_app) => { onInstall?.(); },
  };
}

// ─── Registration ──────────────────────────────────────────────────────────────

describe('PluginManager – registration', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it('registers a plugin', () => {
    manager.register(makePlugin('auth'));
    expect(manager.getPlugin('auth')).toBeDefined();
  });

  it('throws on duplicate name', () => {
    manager.register(makePlugin('auth'));
    expect(() => manager.register(makePlugin('auth'))).toThrow('already registered');
  });

  it('getPlugin returns undefined for unknown plugin', () => {
    expect(manager.getPlugin('unknown')).toBeUndefined();
  });

  it('getPluginNames returns all registered names', () => {
    manager.register(makePlugin('a'));
    manager.register(makePlugin('b'));
    expect(manager.getPluginNames()).toContain('a');
    expect(manager.getPluginNames()).toContain('b');
  });

  it('isInstalled returns false before install', () => {
    manager.register(makePlugin('auth'));
    expect(manager.isInstalled('auth')).toBe(false);
  });
});

// ─── Installation ─────────────────────────────────────────────────────────────

describe('PluginManager – install', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it('installs plugin and marks as installed', async () => {
    manager.register(makePlugin('auth'));
    await manager.install({} as any);
    expect(manager.isInstalled('auth')).toBe(true);
  });

  it('calls install callback', async () => {
    let called = false;
    manager.register(makePlugin('auth', undefined, () => { called = true; }));
    await manager.install({} as any);
    expect(called).toBe(true);
  });

  it('installs multiple plugins', async () => {
    const installed: string[] = [];
    manager.register(makePlugin('a', undefined, () => installed.push('a')));
    manager.register(makePlugin('b', undefined, () => installed.push('b')));
    await manager.install({} as any);
    expect(installed).toContain('a');
    expect(installed).toContain('b');
  });
});

// ─── Dependency resolution ─────────────────────────────────────────────────────

describe('PluginManager – dependency order', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it('installs dependency before dependent', async () => {
    const order: string[] = [];
    manager.register(makePlugin('base', undefined, () => order.push('base')));
    manager.register(makePlugin('auth', ['base'], () => order.push('auth')));
    await manager.install({} as any);
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('auth'));
  });

  it('resolves transitive deps: A → B → C installs C, B, A', async () => {
    const order: string[] = [];
    manager.register(makePlugin('C', undefined, () => order.push('C')));
    manager.register(makePlugin('B', ['C'], () => order.push('B')));
    manager.register(makePlugin('A', ['B'], () => order.push('A')));
    await manager.install({} as any);
    expect(order).toEqual(['C', 'B', 'A']);
  });

  it('shared dep installed only once with multiple dependents', async () => {
    const order: string[] = [];
    manager.register(makePlugin('db', undefined, () => order.push('db')));
    manager.register(makePlugin('auth', ['db'], () => order.push('auth')));
    manager.register(makePlugin('cache', ['db'], () => order.push('cache')));
    await manager.install({} as any);
    expect(order.filter(n => n === 'db').length).toBe(1);
  });

  it('throws on missing dependency', () => {
    manager.register(makePlugin('auth', ['nonexistent']));
    expect(manager.install({} as any)).rejects.toThrow();
  });

  it('throws on circular dependency', () => {
    manager.register(makePlugin('a', ['b']));
    manager.register(makePlugin('b', ['a']));
    expect(manager.install({} as any)).rejects.toThrow('Circular dependency');
  });

  it('no-op when no plugins registered', async () => {
    await expect(manager.install({} as any)).resolves.toBeUndefined();
  });
});

// ─── Plugin with version ──────────────────────────────────────────────────────

describe('Plugin interface', () => {
  it('plugin with version field is accepted', () => {
    const p: Plugin = {
      name: 'my-plugin',
      version: '1.2.3',
      install: async () => {},
    };
    const manager = new PluginManager();
    manager.register(p);
    expect(manager.getPlugin('my-plugin')?.version).toBe('1.2.3');
  });

  it('async install resolves successfully', async () => {
    const p: Plugin = {
      name: 'async-plugin',
      install: async () => {
        await new Promise(r => setTimeout(r, 1));
      },
    };
    const manager = new PluginManager();
    manager.register(p);
    await expect(manager.install({} as any)).resolves.toBeUndefined();
    expect(manager.isInstalled('async-plugin')).toBe(true);
  });
});
