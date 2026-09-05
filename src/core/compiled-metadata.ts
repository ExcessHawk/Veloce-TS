/**
 * @module veloce-ts/core/compiled-metadata
 * @description {@link MetadataCompiler}: precomputes dense parameter/dependency arrays and the maximum
 * argument index from {@link RouteMetadata} to speed up dispatch in {@link RouterCompiler}.
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

  /** Handler for functional routes (absent for decorator-based routes) */
  handler?: (c: any, ...args: any[]) => any;
}

/**
 * MetadataCompiler pre-processes route metadata for optimal runtime performance.
 * This reduces the work needed during request processing.
 */
export class MetadataCompiler {
  /**
   * Identity cache: the same RouteMetadata *object* compiles to the same
   * result. A WeakMap keyed on the object needs no snapshot hashing, cannot
   * produce a false hit for a different route, and is collected with the
   * route itself — so nothing leaks across app instances in test suites.
   */
  private static cache = new WeakMap<RouteMetadata, CompiledRouteMetadata>();

  /** Drop every cached compilation (useful between test runs). */
  static clearCache(): void {
    this.cache = new WeakMap();
  }

  /**
   * Compile a route metadata object into an optimized version.
   */
  static compile(route: RouteMetadata): CompiledRouteMetadata {
    const cached = this.cache.get(route);
    if (cached) {
      return cached;
    }

    // Dense, index-ordered copies so the hot path never re-checks sparse slots
    const parametersDense = this.toDense(route.parameters);
    const dependenciesDense = this.toDense(route.dependencies);

    const compiled: CompiledRouteMetadata = {
      ...route,
      parametersDense,
      dependenciesDense,
      maxArgumentIndex: this.calculateMaxArgumentIndex(parametersDense, dependenciesDense),
    };

    this.cache.set(route, compiled);
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
   * Batch compile multiple routes (application startup).
   */
  static compileAll(routes: RouteMetadata[]): CompiledRouteMetadata[] {
    return routes.map(route => this.compile(route));
  }
}
