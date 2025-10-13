import type { Provider, Scope, Context, ProviderConfig, Class } from '../types';

/**
 * Dependency Injection Container
 * Manages dependency lifecycle with support for singleton, request, and transient scopes
 * 
 * Performance optimizations:
 * - Singleton instances cached globally for reuse across all requests
 * - Request-scoped instances cached per-request using WeakMap for automatic cleanup
 * - Provider name cache to avoid repeated string operations
 * - Fast-path for already resolved singletons
 */
export class DIContainer {
  // Storage for singleton instances (global cache) - optimized for fast lookups
  private singletons: Map<Provider, any> = new Map();
  
  // Storage for request-scoped instances (per-request cache) - uses WeakMap for automatic GC
  private requestScoped: WeakMap<Context, Map<Provider, any>> = new WeakMap();
  
  // Provider configurations - cached to avoid repeated lookups
  private providers: Map<Provider, ProviderConfig> = new Map();
  
  // Track resolution stack for circular dependency detection
  private resolutionStack: Set<Provider> = new Set();
  
  // Cache provider names for error messages (avoid repeated string operations)
  private providerNameCache: WeakMap<Provider, string> = new WeakMap();
  
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
   * Optimized with fast-path for cached singletons and request-scoped instances
   * 
   * @param provider - The provider to resolve
   * @param options - Resolution options including scope and context
   * @returns The resolved dependency instance
   */
  async resolve<T>(
    provider: Provider<T>,
    options?: { scope?: Scope; context?: Context }
  ): Promise<T> {
    const config = this.providers.get(provider) || { scope: options?.scope || 'transient' };
    const scope = options?.scope || config.scope || 'transient';

    // Fast-path for singleton: check cache first before any other operations
    if (scope === 'singleton') {
      // Check if already cached (hot path - most common case)
      if (this.singletons.has(provider)) {
        this.stats.singletonHits++;
        return this.singletons.get(provider);
      }
      
      this.stats.singletonMisses++;
      
      // Check for circular dependencies only when creating new instance
      if (this.resolutionStack.has(provider)) {
        throw new Error(`Circular dependency detected: ${this.buildCircularDependencyMessage(provider)}`);
      }

      // Create and cache singleton
      this.resolutionStack.add(provider);
      try {
        const instance = await this.create(provider, config, options?.context);
        this.singletons.set(provider, instance);
        return instance;
      } finally {
        this.resolutionStack.delete(provider);
      }
    }

    // Fast-path for request-scoped: check cache first
    if (scope === 'request' && options?.context) {
      let requestMap = this.requestScoped.get(options.context);
      
      // Check if already cached in this request
      if (requestMap?.has(provider)) {
        this.stats.requestHits++;
        return requestMap.get(provider);
      }
      
      this.stats.requestMisses++;
      
      // Initialize request map if needed
      if (!requestMap) {
        requestMap = new Map();
        this.requestScoped.set(options.context, requestMap);
      }

      // Check for circular dependencies only when creating new instance
      if (this.resolutionStack.has(provider)) {
        throw new Error(`Circular dependency detected: ${this.buildCircularDependencyMessage(provider)}`);
      }

      // Create and cache request-scoped instance
      this.resolutionStack.add(provider);
      try {
        const instance = await this.create(provider, config, options.context);
        requestMap.set(provider, instance);
        return instance;
      } finally {
        this.resolutionStack.delete(provider);
      }
    }

    // Transient: new instance every time (no caching)
    this.stats.transientCreations++;
    
    // Check for circular dependencies
    if (this.resolutionStack.has(provider)) {
      throw new Error(`Circular dependency detected: ${this.buildCircularDependencyMessage(provider)}`);
    }

    this.resolutionStack.add(provider);
    try {
      return await this.create(provider, config, options?.context);
    } finally {
      this.resolutionStack.delete(provider);
    }
  }

  /**
   * Build a detailed circular dependency error message
   * Uses cached provider names for performance
   */
  private buildCircularDependencyMessage(provider: Provider): string {
    const stackArray = Array.from(this.resolutionStack);
    const providerName = this.getProviderName(provider);
    const cycle = stackArray.map(p => this.getProviderName(p)).join(' -> ') + ' -> ' + providerName;
    return cycle;
  }

  /**
   * Create a new instance of the provider
   * @param provider - The provider to instantiate
   * @param config - Provider configuration
   * @param context - Optional context for request-scoped dependencies
   * @returns The created instance
   */
  private async create<T>(
    provider: Provider<T>,
    config: ProviderConfig,
    context?: Context
  ): Promise<T> {
    // Use custom factory if provided
    if (config.factory) {
      return config.factory();
    }

    if (typeof provider === 'function') {
      // Check if it's a class (has prototype) or a factory function
      if (provider.prototype && provider.prototype.constructor === provider) {
        // It's a class - instantiate it
        // Check if the class has constructor dependencies
        const instance = new (provider as Class<T>)();
        
        // Resolve nested dependencies if any are registered
        // This allows for constructor injection in the future
        await this.resolveNestedDependencies(instance, context);
        
        return instance;
      } else {
        // It's a factory function - call it
        const result = (provider as Function)();
        // Handle both sync and async factories
        return result instanceof Promise ? await result : result;
      }
    }

    throw new Error('Invalid provider type');
  }

  /**
   * Resolve nested dependencies for an instance
   * This method can be extended to support constructor injection
   * @param instance - The instance to resolve dependencies for
   * @param context - Optional context for request-scoped dependencies
   */
  private async resolveNestedDependencies(instance: any, context?: Context): Promise<void> {
    // This is a placeholder for future nested dependency resolution
    // Currently, dependencies are resolved at the parameter level by the RouterCompiler
    // In the future, this could support constructor injection by reading metadata
    // from the class constructor parameters
  }

  /**
   * Get a human-readable name for a provider (for error messages)
   * Uses cache to avoid repeated string operations
   * 
   * @param provider - The provider to get the name for
   * @returns A string representation of the provider
   */
  private getProviderName(provider: Provider): string {
    // Check cache first
    const cached = this.providerNameCache.get(provider);
    if (cached) {
      return cached;
    }
    
    // Generate name
    let name: string;
    if (typeof provider === 'function') {
      if (provider.name) {
        name = provider.name;
      } else {
        name = provider.toString().substring(0, 50);
      }
    } else {
      name = String(provider);
    }
    
    // Cache for future use
    this.providerNameCache.set(provider, name);
    return name;
  }

  /**
   * Clear all cached instances (useful for testing)
   */
  clear(): void {
    this.singletons.clear();
    this.providers.clear();
    this.resolutionStack.clear();
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
