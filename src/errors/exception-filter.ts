import type { Context } from 'hono';

export interface ExceptionFilter<T extends Error = Error> {
  catch(error: T, c: Context): Response | Promise<Response>;
}

const CATCH_METADATA_KEY = 'veloce:catch_error_classes';

export function Catch(...errorClasses: Array<new (...args: any[]) => Error>): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(CATCH_METADATA_KEY, errorClasses, target);
  };
}

export class FilterManager {
  private entries: Array<{
    filter: ExceptionFilter;
    errorClasses: Array<new (...args: any[]) => Error>;
  }> = [];

  register(filter: ExceptionFilter): void {
    const errorClasses: Array<new (...args: any[]) => Error> =
      Reflect.getMetadata(CATCH_METADATA_KEY, filter.constructor) ?? [Error];
    this.entries.push({ filter, errorClasses });
  }

  async handle(error: Error, c: Context): Promise<Response | null> {
    for (const { filter, errorClasses } of this.entries) {
      if (errorClasses.some(cls => error instanceof cls)) {
        return filter.catch(error, c);
      }
    }
    return null;
  }

  get size(): number { return this.entries.length; }
}
