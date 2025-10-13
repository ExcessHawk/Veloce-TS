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
}

/**
 * MetadataCompiler pre-processes route metadata for optimal runtime performance
 * This reduces the work needed during request processing
 */
export class MetadataCompiler {
  /**
   * Compile a route metadata object into an optimized version
   * Pre-computes regex patterns, parameter order, and other expensive operations
   */
  static compile(route: RouteMetadata): CompiledRouteMetadata {
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
    const flags = this.computeParameterFlags(route.parameters);
    
    return {
      ...route,
      pathRegex,
      parameterOrder,
      dependencyOrder,
      maxArgumentIndex,
      ...flags
    };
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
  private static computeParameterFlags(parameters: ParameterMetadata[]): {
    hasBody: boolean;
    hasQuery: boolean;
    hasParams: boolean;
    hasHeaders: boolean;
    hasCookies: boolean;
    hasDependencies: boolean;
  } {
    if (!parameters || parameters.length === 0) {
      return {
        hasBody: false,
        hasQuery: false,
        hasParams: false,
        hasHeaders: false,
        hasCookies: false,
        hasDependencies: false
      };
    }
    
    return {
      hasBody: parameters.some(p => p.type === 'body'),
      hasQuery: parameters.some(p => p.type === 'query'),
      hasParams: parameters.some(p => p.type === 'param'),
      hasHeaders: parameters.some(p => p.type === 'header'),
      hasCookies: parameters.some(p => p.type === 'cookie'),
      hasDependencies: false // Dependencies are tracked separately
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
