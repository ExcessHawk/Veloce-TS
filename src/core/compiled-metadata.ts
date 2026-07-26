/**
 * @module veloce-ts/core/compiled-metadata
 * @description {@link MetadataCompiler}: precomputa arrays densos de parámetros/dependencias y el índice
 * máximo de argumento a partir de {@link RouteMetadata} para acelerar el dispatch en {@link RouterCompiler}.
 */
import type { RouteMetadata, ParameterMetadata, DependencyMetadata } from '../types';

/**
 * Compiled route metadata with pre-computed values for performance.
 * Every field here is consumed by the request hot path in RouterCompiler —
 * do not add speculative precomputation that the handler never reads.
 */
export interface CompiledRouteMetadata extends RouteMetadata {
  /** Parameters with sparse/undefined entries filtered out, in index order */
  parametersDense: ParameterMetadata[];

  /** Dependencies with sparse/undefined entries filtered out, in index order */
  dependenciesDense: DependencyMetadata[];

  /** Maximum argument index (for exact args-array allocation) */
  maxArgumentIndex: number;

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
    const targetId = route.target
      ? (MetadataCompiler.handlerIds.get(route.target) ?? MetadataCompiler.assignHandlerId(route.target))
      : null;
    return JSON.stringify({
      targetId,
      method: route.method,
      path: route.path,
      params: route.parameters?.map(p => (p ? { i: p.index, t: p.type, n: p.name } : null)),
      deps: route.dependencies?.map(d => (d ? { i: d.index } : null)),
      handlerId: handler ? (MetadataCompiler.handlerIds.get(handler) ?? MetadataCompiler.assignHandlerId(handler)) : null,
      mw: route.middleware?.map(m => MetadataCompiler.handlerIds.get(m) ?? MetadataCompiler.assignHandlerId(m)),
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
    const targetId = route.target
      ? (MetadataCompiler.handlerIds.get(route.target) ?? MetadataCompiler.assignHandlerId(route.target))
      : 0;
    const cacheKey = `${targetId}:${route.propertyKey}`;
    const snap = this.snapshot(route);

    const cached = this.cache.get(cacheKey);
    if (cached && this.snapshotCache.get(cacheKey) === snap) {
      return cached;
    }

    // Dense, index-ordered copies so the hot path never re-checks sparse slots
    const parametersDense = this.toDense(route.parameters);
    const dependenciesDense = this.toDense(route.dependencies);

    // Calculate maximum argument index
    const maxArgumentIndex = this.calculateMaxArgumentIndex(
      parametersDense,
      dependenciesDense
    );

    const compiled: CompiledRouteMetadata = {
      ...route,
      parametersDense,
      dependenciesDense,
      maxArgumentIndex,
    };

    this.cache.set(cacheKey, compiled);
    this.snapshotCache.set(cacheKey, snap);

    return compiled;
  }

  /**
   * Filter out sparse/undefined slots and sort by declared argument index,
   * so the request-time loops can iterate without per-entry guards.
   */
  private static toDense<T extends { index?: number }>(entries?: T[]): T[] {
    if (!entries || entries.length === 0) {
      return [];
    }
    return entries
      .filter((e): e is T => e !== undefined && e !== null && e.index !== undefined)
      .sort((a, b) => (a.index as number) - (b.index as number));
  }

  /**
   * Calculate the maximum argument index to determine array size
   * This allows pre-allocation of the arguments array
   */
  private static calculateMaxArgumentIndex(
    parameters: ParameterMetadata[],
    dependencies: DependencyMetadata[]
  ): number {
    let maxIndex = -1;

    for (const p of parameters) {
      if (p.index > maxIndex) maxIndex = p.index;
    }
    for (const d of dependencies) {
      if (d.index > maxIndex) maxIndex = d.index;
    }

    return maxIndex;
  }

  /**
   * Batch compile multiple routes for efficiency
   * Useful when compiling all routes at application startup
   */
  static compileAll(routes: RouteMetadata[]): CompiledRouteMetadata[] {
    return routes.map(route => this.compile(route));
  }
}
