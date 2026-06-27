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

export function getInterceptors(target: any, propertyKey?: string): Interceptor[] {
  const classInterceptors: Interceptor[] =
    Reflect.getMetadata(USE_INTERCEPTORS_KEY, target.constructor ?? target) ?? [];
  if (!propertyKey) return classInterceptors;
  const methodInterceptors: Interceptor[] =
    Reflect.getMetadata(USE_INTERCEPTORS_KEY, target.prototype ?? target, propertyKey) ?? [];
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
    const chain = [...this.globals, ...localInterceptors];
    let i = 0;
    const next = async (): Promise<Response> => {
      if (i >= chain.length) return handler();
      return chain[i++].intercept(ctx, next);
    };
    return next();
  }
}
