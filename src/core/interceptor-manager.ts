export interface ExecutionContext {
  request: Request;
  handlerName: string;
  controllerName: string;
}

export interface Interceptor {
  intercept(context: ExecutionContext, next: () => Promise<Response>): Promise<Response>;
}

const USE_INTERCEPTORS_KEY = 'veloce:interceptors';

export function UseInterceptor(...interceptors: Interceptor[]): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey !== undefined) {
      const existing: Interceptor[] = Reflect.getMetadata(USE_INTERCEPTORS_KEY, target, propertyKey) ?? [];
      Reflect.defineMetadata(USE_INTERCEPTORS_KEY, [...existing, ...interceptors], target, propertyKey);
    } else {
      const existing: Interceptor[] = Reflect.getMetadata(USE_INTERCEPTORS_KEY, target) ?? [];
      Reflect.defineMetadata(USE_INTERCEPTORS_KEY, [...existing, ...interceptors], target);
    }
  };
}

/**
 * Collect class-level + method-level interceptors for a controller method.
 * `target` may be the class constructor (what RouteMetadata.target holds) or
 * its prototype (what a method decorator receives) — both are normalised so
 * class-level `@UseInterceptor` is found in either case.
 */
export function getInterceptors(target: any, propertyKey?: string): Interceptor[] {
  const ctor: Function | undefined =
    typeof target === 'function' ? target : target?.constructor;
  const proto: object | undefined =
    typeof target === 'function' ? target.prototype : target;

  const classInterceptors: Interceptor[] =
    (ctor && Reflect.getMetadata(USE_INTERCEPTORS_KEY, ctor)) ?? [];
  if (!propertyKey || !proto) return classInterceptors;
  const methodInterceptors: Interceptor[] =
    Reflect.getMetadata(USE_INTERCEPTORS_KEY, proto, propertyKey) ?? [];
  return [...classInterceptors, ...methodInterceptors];
}

export class InterceptorManager {
  private globals: Interceptor[] = [];

  addGlobal(interceptor: Interceptor): void {
    this.globals.push(interceptor);
  }

  async execute(
    localInterceptors: Interceptor[],
    handler: () => Promise<Response>,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Fast paths: avoid array allocation when there is nothing to chain
    if (this.globals.length === 0 && localInterceptors.length === 0) {
      return handler();
    }
    const chain =
      this.globals.length === 0
        ? localInterceptors
        : localInterceptors.length === 0
          ? this.globals
          : [...this.globals, ...localInterceptors];
    let i = 0;
    const next = async (): Promise<Response> => {
      if (i >= chain.length) return handler();
      return chain[i++].intercept(ctx, next);
    };
    return next();
  }
}
