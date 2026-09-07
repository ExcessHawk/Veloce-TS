/**
 * @module veloce-ts/core/plugin
 * @description The {@link Plugin} contract, {@link PluginManager} and install ordering: core extensions
 * (OpenAPI, GraphQL, WebSocket, ORM, auth) applied before {@link VeloceTS.compile}.
 */
import type { VeloceTS } from './application.js';

/**
 * Plugin interface that all plugins must implement
 * Plugins can extend the framework with additional functionality
 */
export interface Plugin {
  /** Unique name of the plugin */
  name: string;
  
  /** Optional version string */
  version?: string;
  
  /** Optional list of plugin names this plugin depends on */
  dependencies?: string[];
  
  /**
   * Install method called when the plugin is registered
   * @param app - The VeloceTS application instance
   */
  install(app: VeloceTS): void | Promise<void>;

  /**
   * Called after the server starts listening. Use it to start background
   * work (timers, consumers) that needs the app fully running.
   */
  onStart?(app: VeloceTS): void | Promise<void>;

  /**
   * Called during graceful shutdown, in reverse install order. Use it to
   * release resources the plugin opened (connections, timers, pools).
   */
  onStop?(app: VeloceTS): void | Promise<void>;
}

/**
 * PluginManager handles plugin registration and installation
 * Resolves plugin dependencies using topological sort
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private installed: Set<string> = new Set();

  /**
   * Register a plugin with the manager
   * @param plugin - The plugin to register
   * @throws Error if plugin with same name is already registered
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Install all registered plugins in dependency order
   * @param app - The VeloceTS application instance
   * @throws Error if plugin dependencies cannot be resolved
   */
  private installOrder: string[] = [];

  async install(app: VeloceTS): Promise<void> {
    // Resolve installation order using topological sort
    const order = this.resolveInstallOrder();

    // Install plugins in resolved order
    for (const pluginName of order) {
      const plugin = this.plugins.get(pluginName)!;
      await plugin.install(app);
      this.installed.add(pluginName);
    }
    this.installOrder = order;
  }

  /** Run onStart hooks in install order (after the server starts listening) */
  async start(app: VeloceTS): Promise<void> {
    for (const name of this.installOrder) {
      const plugin = this.plugins.get(name)!;
      if (plugin.onStart) {
        await plugin.onStart(app);
      }
    }
  }

  /**
   * Run onStop hooks in reverse install order during graceful shutdown.
   * Errors are collected so one failing plugin cannot block the teardown
   * of the others; they are rethrown as an AggregateError at the end.
   */
  async stop(app: VeloceTS): Promise<void> {
    const errors: unknown[] = [];
    for (const name of [...this.installOrder].reverse()) {
      const plugin = this.plugins.get(name)!;
      if (plugin.onStop) {
        try {
          await plugin.onStop(app);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} plugin(s) failed to stop`);
    }
  }

  /**
   * Check if a plugin is installed
   * @param name - The plugin name
   * @returns true if the plugin is installed
   */
  isInstalled(name: string): boolean {
    return this.installed.has(name);
  }

  /**
   * Get a registered plugin by name
   * @param name - The plugin name
   * @returns The plugin or undefined if not found
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugin names
   * @returns Array of plugin names
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Resolve plugin installation order using topological sort
   * Ensures dependencies are installed before dependents
   * @returns Array of plugin names in installation order
   * @throws Error if circular dependencies are detected or dependencies are missing
   */
  private resolveInstallOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (name: string, path: string[] = []): void => {
      // Check for circular dependencies
      if (visiting.has(name)) {
        const cycle = [...path, name].join(' -> ');
        throw new Error(`Circular dependency detected in plugins: ${cycle}`);
      }

      // Skip if already visited
      if (visited.has(name)) {
        return;
      }

      // Mark as currently visiting
      visiting.add(name);

      // Get the plugin
      const plugin = this.plugins.get(name);
      if (!plugin) {
        throw new Error(`Plugin "${name}" is not registered`);
      }

      // Visit dependencies first
      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.plugins.has(dep)) {
            throw new Error(
              `Plugin "${name}" depends on "${dep}" which is not registered`
            );
          }
          visit(dep, [...path, name]);
        }
      }

      // Mark as visited and remove from visiting
      visiting.delete(name);
      visited.add(name);

      // Add to order after all dependencies
      order.push(name);
    };

    // Visit all plugins
    for (const name of this.plugins.keys()) {
      visit(name);
    }

    return order;
  }
}
