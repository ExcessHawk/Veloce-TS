/**
 * @module veloce-ts/core/compiled-metadata
 * @description {@link MetadataCompiler}: precomputa regex de path, orden de parámetros/dependencias y flags
 * (`hasBody`, etc.) a partir de {@link RouteMetadata} para acelerar el dispatch en {@link RouterCompiler}.
 */
import type { RouteMetadata, ParameterMetadata } from '../types';

/**
 * Compiled route metadata with pre-computed values for performance
 */
export interface CompiledRouteMetadata extends RouteMetadata {
  // Pre-compiled path regex for matching
  pathRegex?: RegExp;
  
  // Pre-resolved parameter order (indices sorted)
  parameterOrder: number[];
  
  // Pre-resolved dependency order (indices sorted)
  dependencyOrder: number[];
  
  // Maximum argument index (for array allocation)
  maxArgumentIndex: number;
  
  // Flags for quick checks
  hasBody: boolean;
  hasQuery: boolean;
  hasParams: boolean;
  hasHeaders: boolean;
  hasCookies: boolean;
  hasDependencies: boolean;
  
  // Handler for functional routes
  handler?: (c: any, ...args: any[]) => any;
}

/**
 * MetadataCompiler pre-processes route metadata for optimal runtime performance
 * This reduces the work needed during request processing
 */
export class MetadataCompiler {
  /**
   * Route compilation cache keyed by `ControllerName:methodName`.
   * A second Map stores the exact metadata snapshot used to build the cache
   * entry so we can detect if the metadata has changed (e.g. during testing
   * when routes are re-registered).
   */
  private static cache = new Map<string, CompiledRouteMetadata>();
  private static snapshotCache = new Map<string, string>();

  /** Invalidate all cached compilations (useful between test runs). */
  static clearCache(): void {
    this.cache.clear();
    this.snapshotCache.clear();
  }

  /**
   * Compute a stable snapshot key for a RouteMetadata object.
   * We only hash the fields that affect compilation output.
   * Functional routes carry an inline `handler` function whose identity
   * must be part of the snapshot to avoid false cache hits across different
   * app instances that register the same path.
   */
  private static snapshot(route: RouteMetadata): string {
    const handler = (route as any).handler;
    return JSON.stringify({
      method: route.method,
      path: route.path,
      params: route.parameters?.map(p => ({ i: p.index, t: p.type, n: p.name })),
      deps: route.dependencies?.map(d => ({ i: d.index })),
      // Use a per-function symbol so two different handler functions with the
      // same source text still produce different snapshots.
      handlerId: handler ? (MetadataCompiler.handlerIds.get(handler) ?? MetadataCompiler.assignHandlerId(handler)) : null,
    });
  }

  private static handlerIds = new WeakMap<Function, number>();
  private static nextHandlerId = 0;

  private static assignHandlerId(fn: Function): number {
    const id = ++MetadataCompiler.nextHandlerId;
    MetadataCompiler.handlerIds.set(fn, id);
    return id;
  }

  /**
   * Compile a route metadata object into an optimized version.
   * Results are cached by controller + method key; the cache is invalidated
   * automatically when the metadata changes (covers hot-reload / test scenarios).
   *
   * Functional routes (which carry an inline handler function) are also cached,
   * but each unique handler function gets its own cache slot so that two different
   * app instances registering the same path don't share compiled metadata.
   */
  static compile(route: RouteMetadata): CompiledRouteMetadata {
    const cacheKey = `${route.target?.name ?? 'anon'}:${route.propertyKey}`;
    const snap = this.snapshot(route);

    const cached = this.cache.get(cacheKey);
    if (cached && this.snapshotCache.get(cacheKey) === snap) {
      return cached;
    }

    // Pre-compile path regex for parameter extraction
    const pathRegex = this.compilePathRegex(route.path);
    
    // Pre-resolve parameter order
    const parameterOrder = this.resolveParameterOrder(route.parameters);
    
    // Pre-resolve dependency order
    const dependencyOrder = this.resolveDependencyOrder(route.dependencies);
    
    // Calculate maximum argument index
    const maxArgumentIndex = this.calculateMaxArgumentIndex(
      route.parameters,
      route.dependencies
    );
    
    // Pre-compute parameter type flags for quick checks
    const flags = this.computeParameterFlags(route.parameters, route.dependencies);
    
    const compiled: CompiledRouteMetadata = {
      ...route,
      pathRegex,
      parameterOrder,
      dependencyOrder,
      maxArgumentIndex,
      ...flags,
    };

    this.cache.set(cacheKey, compiled);
    this.snapshotCache.set(cacheKey, snap);

    return compiled;
  }

  /**
   * Compile path pattern into a regex for efficient matching
   * Converts FastAPI-style {param} to regex capture groups
   */
  private static compilePathRegex(path: string): RegExp {
    // Escape special regex characters except for parameter placeholders
    let pattern = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Convert {param} to named capture groups
    pattern = pattern.replace(/\\\{([^}]+)\\\}/g, '(?<$1>[^/]+)');
    
    // Convert :param to named capture groups (Hono style)
    pattern = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '(?<$1>[^/]+)');
    
    // Anchor to start and end
    pattern = `^${pattern}$`;
    
    return new RegExp(pattern);
  }

  /**
   * Resolve the order of parameters by their indices
   * Returns sorted array of indices for efficient iteration
   */
  private static resolveParameterOrder(parameters: ParameterMetadata[]): number[] {
    if (!parameters || parameters.length === 0) {
      return [];
    }
    
    // Extract indices and sort them
    return parameters
      .map(p => p.index)
      .filter(idx => idx !== undefined)
      .sort((a, b) => a - b);
  }

  /**
   * Resolve the order of dependencies by their indices
   * Returns sorted array of indices for efficient iteration
   */
  private static resolveDependencyOrder(dependencies: any[]): number[] {
    if (!dependencies || dependencies.length === 0) {
      return [];
    }
    
    // Extract indices and sort them
    return dependencies
      .map(d => d.index)
      .filter(idx => idx !== undefined)
      .sort((a, b) => a - b);
  }

  /**
   * Calculate the maximum argument index to determine array size
   * This allows pre-allocation of the arguments array
   */
  private static calculateMaxArgumentIndex(
    parameters: ParameterMetadata[],
    dependencies: any[]
  ): number {
    let maxIndex = -1;
    
    if (parameters && parameters.length > 0) {
      const maxParamIndex = Math.max(...parameters.map(p => p.index));
      maxIndex = Math.max(maxIndex, maxParamIndex);
    }
    
    if (dependencies && dependencies.length > 0) {
      const maxDepIndex = Math.max(...dependencies.map(d => d.index));
      maxIndex = Math.max(maxIndex, maxDepIndex);
    }
    
    return maxIndex;
  }

  /**
   * Pre-compute flags for parameter types to avoid repeated checks
   * These flags enable quick conditional logic during request processing
   */
  private static computeParameterFlags(
    parameters: ParameterMetadata[],
    dependencies?: any[]
  ): {
    hasBody: boolean;
    hasQuery: boolean;
    hasParams: boolean;
    hasHeaders: boolean;
    hasCookies: boolean;
    hasDependencies: boolean;
  } {
    const hasDependencies = !!(dependencies && dependencies.length > 0);

    if (!parameters || parameters.length === 0) {
      return {
        hasBody: false,
        hasQuery: false,
        hasParams: false,
        hasHeaders: false,
        hasCookies: false,
        hasDependencies
      };
    }
    
    return {
      hasBody: parameters.some(p => p.type === 'body'),
      hasQuery: parameters.some(p => p.type === 'query'),
      hasParams: parameters.some(p => p.type === 'param'),
      hasHeaders: parameters.some(p => p.type === 'header'),
      hasCookies: parameters.some(p => p.type === 'cookie'),
      hasDependencies
    };
  }

  /**
   * Batch compile multiple routes for efficiency
   * Useful when compiling all routes at application startup
   */
  static compileAll(routes: RouteMetadata[]): CompiledRouteMetadata[] {
    return routes.map(route => this.compile(route));
  }
}
