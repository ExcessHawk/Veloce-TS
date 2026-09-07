/**
 * @module veloce-ts/dependencies/container
 * @description {@link DIContainer}: provider registration and resolution with singleton, request and
 * transient scopes; circular-dependency detection and resolution statistics.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Provider, Scope, Context, ProviderConfig, Class } from '../types/index.js';
import { MetadataRegistry } from '../core/metadata.js';

/**
 * Dependency Injection Container
 * Manages dependency lifecycle with support for singleton, request, and transient scopes
 *
 * Performance / correctness notes:
 * - Singleton instances are cached globally; concurrent first-time resolves share one
 *   in-flight promise so exactly one instance is ever created.
 * - Request-scoped instances are cached per request in a WeakMap (automatic cleanup).
 * - Circular-dependency detection uses a *per-resolution* path, not container-wide state,
 *   so two unrelated requests resolving the same provider at the same time never see a
 *   false "Circular dependency detected".
 */
export class DIContainer {
  /**
   * The chain of providers currently being constructed, scoped to the async
   * context doing the constructing. A provider that resolves itself (directly,
   * through a constructor dependency, or from inside its own factory) sees
   * itself in this chain and fails fast.
   *
   * It is deliberately *not* container-wide state: two requests resolving the
   * same provider at the same time run in separate async contexts, so they no
   * longer accuse each other of a circular dependency.
   */
  private static readonly resolutionPath = new AsyncLocalStorage<Set<Provider>>();

  // Storage for singleton instances (global cache)
  private singletons: Map<Provider, any> = new Map();

  // In-flight singleton creations — concurrent callers await the same promise
  private singletonInFlight: Map<Provider, Promise<any>> = new Map();

  // Storage for request-scoped instances (per-request cache) - WeakMap for automatic GC
  private requestScoped: WeakMap<Context, Map<Provider, any>> = new WeakMap();

  // In-flight request-scoped creations, per request
  private requestInFlight: WeakMap<Context, Map<Provider, Promise<any>>> = new WeakMap();

  // Provider configurations
  private providers: Map<Provider, ProviderConfig> = new Map();

  // Cache provider names for error messages (only for object providers)
  private providerNameCache: WeakMap<object, string> = new WeakMap();

  // Statistics for monitoring performance (optional, for debugging)
  private stats = {
    singletonHits: 0,
    singletonMisses: 0,
    requestHits: 0,
    requestMisses: 0,
    transientCreations: 0
  };

  /**
   * Register a provider with optional configuration
   * @param provider - Class or factory function to provide the dependency
   * @param config - Configuration including scope and factory
   */
  register(provider: Provider, config?: ProviderConfig): void {
    this.providers.set(provider, config || { scope: 'transient' });
  }

  /**
   * Resolve a dependency with the specified scope
   *
   * @param provider - The provider to resolve
   * @param options - Resolution options including scope and context
   * @returns The resolved dependency instance
   */
  resolve<T>(
    provider: Provider<T>,
    options?: { scope?: Scope; context?: Context }
  ): Promise<T> {
    // Inherit the caller's resolution chain when there is one (i.e. we're
    // inside another provider's factory or constructor), otherwise start fresh.
    const path = DIContainer.resolutionPath.getStore() ?? new Set<Provider>();
    return this.resolveWithPath(provider, options, path);
  }

  /**
   * Internal resolve that threads the current resolution path through the
   * recursion (constructor dependencies), so cycles are detected per call.
   */
  private async resolveWithPath<T>(
    provider: Provider<T>,
    options: { scope?: Scope; context?: Context } | undefined,
    path: Set<Provider>
  ): Promise<T> {
    const config = this.providers.get(provider) || { scope: options?.scope || 'transient' };
    const scope = options?.scope || config.scope || 'transient';

    if (path.has(provider)) {
      throw new Error(`Circular dependency detected: ${this.buildCircularDependencyMessage(path, provider)}`);
    }

    // ── Singleton ──────────────────────────────────────────────────────────
    if (scope === 'singleton') {
      if (this.singletons.has(provider)) {
        this.stats.singletonHits++;
        return this.singletons.get(provider);
      }

      const inFlight = this.singletonInFlight.get(provider);
      if (inFlight) {
        // Another caller is already creating it — share the result
        this.stats.singletonHits++;
        return inFlight;
      }

      this.stats.singletonMisses++;
      const creation = this.createInPath(provider, config, options?.context, path)
        .then(instance => {
          this.singletons.set(provider, instance);
          return instance;
        })
        .finally(() => {
          this.singletonInFlight.delete(provider);
        });
      this.singletonInFlight.set(provider, creation);
      return creation;
    }

    // ── Request ────────────────────────────────────────────────────────────
    if (scope === 'request') {
      const context = options?.context;
      if (!context) {
        throw new Error(
          `Cannot resolve request-scoped provider "${this.getProviderName(provider)}" without a request context. ` +
          'Pass { context } in the resolve options.'
        );
      }

      let requestMap = this.requestScoped.get(context);
      if (requestMap?.has(provider)) {
        this.stats.requestHits++;
        return requestMap.get(provider);
      }

      let inFlightMap = this.requestInFlight.get(context);
      const inFlight = inFlightMap?.get(provider);
      if (inFlight) {
        this.stats.requestHits++;
        return inFlight;
      }

      this.stats.requestMisses++;
      if (!requestMap) {
        requestMap = new Map();
        this.requestScoped.set(context, requestMap);
      }
      if (!inFlightMap) {
        inFlightMap = new Map();
        this.requestInFlight.set(context, inFlightMap);
      }

      const map = requestMap;
      const flight = inFlightMap;
      const creation = this.createInPath(provider, config, context, path)
        .then(instance => {
          map.set(provider, instance);
          return instance;
        })
        .finally(() => {
          flight.delete(provider);
        });
      flight.set(provider, creation);
      return creation;
    }

    // ── Transient ──────────────────────────────────────────────────────────
    this.stats.transientCreations++;
    return this.createInPath(provider, config, options?.context, path);
  }

  /**
   * Construct a provider with `provider` appended to the resolution chain, and
   * publish that chain to the async context so anything the factory/constructor
   * resolves in turn is checked against it.
   */
  private createInPath<T>(
    provider: Provider<T>,
    config: ProviderConfig,
    context: Context | undefined,
    path: Set<Provider>
  ): Promise<T> {
    const nextPath = new Set(path);
    nextPath.add(provider);
    return DIContainer.resolutionPath.run(nextPath, () =>
      this.create(provider, config, context, nextPath)
    );
  }

  /**
   * Build a detailed circular dependency error message from the current path
   */
  private buildCircularDependencyMessage(path: Set<Provider>, provider: Provider): string {
    const chain = Array.from(path).map(p => this.getProviderName(p));
    chain.push(this.getProviderName(provider));
    return chain.join(' -> ');
  }

  /**
   * Create a new instance of the provider
   * @param provider - The provider to instantiate
   * @param config - Provider configuration
   * @param context - Optional context for request-scoped dependencies
   * @param path - Resolution path (for cycle detection in constructor deps)
   * @returns The created instance
   */
  private async create<T>(
    provider: Provider<T>,
    config: ProviderConfig,
    context: Context | undefined,
    path: Set<Provider>
  ): Promise<T> {
    // Use custom factory if provided
    if (config.factory) {
      return config.factory();
    }

    if (typeof provider === 'function') {
      // Check if it's a class (has prototype) or a factory function
      if (provider.prototype && provider.prototype.constructor === provider) {
        // Resolve constructor dependencies from metadata
        const ctorDeps = MetadataRegistry.getDependencyMetadata(
          (provider as Class<T>).prototype,
          'constructor'
        );

        if (ctorDeps && ctorDeps.length > 0) {
          const args: any[] = [];
          for (const dep of ctorDeps) {
            if (!dep) continue;
            args[dep.index] = await this.resolveWithPath(dep.provider, {
              scope: dep.scope,
              context,
            }, path);
          }
          return new (provider as Class<T>)(...args);
        }
        return new (provider as Class<T>)();
      }

      // It's a factory function - call it (sync or async)
      const result = (provider as Function)();
      return result instanceof Promise ? await result : result;
    }

    throw new Error('Invalid provider type');
  }

  /**
   * Get a human-readable name for a provider (for error messages)
   */
  private getProviderName(provider: Provider): string {
    if (typeof provider === 'string') {
      return provider;
    } else if (typeof provider === 'symbol') {
      return provider.toString();
    }

    const cached = this.providerNameCache.get(provider as object);
    if (cached) {
      return cached;
    }

    let name: string;
    if (typeof provider === 'function') {
      name = provider.name || provider.toString().substring(0, 50);
    } else {
      name = String(provider);
    }

    if (typeof provider === 'object' || typeof provider === 'function') {
      this.providerNameCache.set(provider as object, name);
    }

    return name;
  }

  /**
   * Clear all cached instances (useful for testing)
   */
  clear(): void {
    this.singletons.clear();
    this.singletonInFlight.clear();
    this.providers.clear();
    this.providerNameCache = new WeakMap();
    this.resetStats();
  }

  /**
   * Clear request-scoped cache for a specific context
   * This is automatically handled by WeakMap garbage collection,
   * but can be called explicitly for immediate cleanup
   */
  clearRequestScope(context: Context): void {
    this.requestScoped.delete(context);
    this.requestInFlight.delete(context);
  }

  /**
   * Get dependency resolution statistics (useful for monitoring and debugging)
   * Returns cache hit rates and creation counts
   */
  getStats(): {
    singletonHits: number;
    singletonMisses: number;
    singletonHitRate: number;
    requestHits: number;
    requestMisses: number;
    requestHitRate: number;
    transientCreations: number;
  } {
    const singletonTotal = this.stats.singletonHits + this.stats.singletonMisses;
    const singletonHitRate = singletonTotal > 0
      ? (this.stats.singletonHits / singletonTotal) * 100
      : 0;

    const requestTotal = this.stats.requestHits + this.stats.requestMisses;
    const requestHitRate = requestTotal > 0
      ? (this.stats.requestHits / requestTotal) * 100
      : 0;

    return {
      singletonHits: this.stats.singletonHits,
      singletonMisses: this.stats.singletonMisses,
      singletonHitRate: Math.round(singletonHitRate * 100) / 100,
      requestHits: this.stats.requestHits,
      requestMisses: this.stats.requestMisses,
      requestHitRate: Math.round(requestHitRate * 100) / 100,
      transientCreations: this.stats.transientCreations
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    this.stats = {
      singletonHits: 0,
      singletonMisses: 0,
      requestHits: 0,
      requestMisses: 0,
      transientCreations: 0
    };
  }
}
