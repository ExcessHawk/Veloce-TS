/**
 * @module veloce-ts/dependencies/drizzle
 * @description Registro del cliente Drizzle en el DI (`registerDrizzle`, `InjectDB`, `DB_TOKEN`) para inyectar DB en servicios y controladores.
 *
 * Drizzle ORM integration helpers for Veloce-TS DI container.
 *
 * These utilities let you register a Drizzle database instance as an
 * injectable token so that controllers / services can receive it via
 * the standard `@Depends()` / `@InjectDB()` decorators without any
 * manual wiring.
 *
 * @example
 * ```ts
 * import Database from 'bun:sqlite';
 * import { drizzle } from 'drizzle-orm/bun-sqlite';
 * import { registerDrizzle } from 'veloce-ts';
 *
 * const sqlite = new Database('app.db');
 * const db = drizzle(sqlite);
 *
 * // Register once at startup
 * registerDrizzle(app, db);
 *
 * // Inject anywhere with @InjectDB()
 * @Controller('/products')
 * class ProductController {
 *   constructor(@InjectDB() private db: typeof db) {}
 *
 *   @Get('/')
 *   list() { return this.db.select().from(products).all(); }
 * }
 * ```
 */

import type { VeloceTS } from '../core/application';
import { MetadataRegistry } from '../core/metadata';

/** Default token used when no custom name is provided. */
export const DB_TOKEN = Symbol('veloce:db');

/**
 * Register a Drizzle (or any database) instance in the application DI container.
 *
 * @param app   - VeloceTS application instance
 * @param db    - Drizzle database instance (or any DB object)
 * @param token - Optional injection token; defaults to `DB_TOKEN` (`Symbol('veloce:db')`)
 *
 * @example
 * ```ts
 * registerDrizzle(app, db);                    // inject with @InjectDB()
 * registerDrizzle(app, db, 'myDb');             // inject with @Depends('myDb')
 * registerDrizzle(app, db, Symbol('readDb'));   // inject with @Depends(Symbol('readDb'))
 * ```
 */
export function registerDrizzle<T>(
  app: VeloceTS,
  db: T,
  token: string | symbol = DB_TOKEN
): void {
  app.getContainer().register(token as any, {
    scope: 'singleton',
    factory: () => db,
  });
}

/**
 * Parameter decorator — shorthand for `@Depends(DB_TOKEN)`.
 * Injects the database instance registered with `registerDrizzle()`.
 *
 * @param token - Optional custom token if you registered with a custom name
 *
 * @example
 * ```ts
 * @Controller('/users')
 * class UserController {
 *   constructor(@InjectDB() private db: typeof db) {}
 * }
 * ```
 */
export function InjectDB(token: string | symbol = DB_TOKEN): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey === undefined) {
      // Constructor injection
      MetadataRegistry.defineDependency(target.prototype, 'constructor', parameterIndex, {
        index: parameterIndex,
        provider: token as any,
        scope: 'singleton',
      });
    } else {
      MetadataRegistry.defineDependency(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        provider: token as any,
        scope: 'singleton',
      });
    }
  };
}
