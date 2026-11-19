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

import type { VeloceTS } from '../core/application.js';
import type { Context } from '../types/index.js';
import { MetadataRegistry } from '../core/metadata.js';
import {
  createTransactionalDb,
  runInTransaction,
  runWithRequest,
  RollbackSignal,
  type OnBeginTransaction,
} from '../orm/transaction-context.js';

/** Options for {@link registerDrizzle}. */
export interface RegisterDrizzleOptions {
  /** Injection token; defaults to `DB_TOKEN` (inject with `@InjectDB()`). */
  token?: string | symbol;
  /**
   * Wrap each request in one transaction: committed when the request
   * succeeds, rolled back when it fails (an error reached the framework's error
   * handling, or the response is a 5xx).
   *
   * `true` wraps every request; a function decides per request — typically
   * `(c) => c.req.method !== 'GET'`. Off by default: a transaction holds a pool
   * connection for the whole request, including time spent waiting on other
   * services, so prefer `@Transactional()` / `runInTransaction` on the
   * operations that need it and reserve this for apps where that is acceptable.
   *
   * Streaming responses (`text/event-stream`) are never wrapped: they outlive
   * the handler.
   */
  transactionPerRequest?: boolean | ((c: Context) => boolean);
  /**
   * Runs at the start of every outermost transaction on this database, inside
   * it, before any query. `c` is the current request when there is one.
   *
   * This is where per-transaction session state belongs — for example the
   * tenant that PostgreSQL row-level security policies read:
   *
   * ```ts
   * onBegin: async (tx, c) => {
   *   const tenant = c?.get('tenant');
   *   if (tenant) await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
   * }
   * ```
   */
  onBegin?: OnBeginTransaction;
}

/** Default token used when no custom name is provided. */
export const DB_TOKEN = Symbol.for('veloce-ts:veloce:db');

/**
 * Register a Drizzle (or any database) instance in the application DI container.
 *
 * What gets injected is a transaction-aware handle to `db`: it behaves exactly
 * like `db`, except that inside `runInTransaction()` / `@Transactional()` (or a
 * per-request transaction) its queries run in that transaction. Code that keeps
 * `this.db` from its constructor therefore needs no changes to be transactional.
 *
 * @param app   - VeloceTS application instance
 * @param db    - Drizzle database instance (or any DB object)
 * @param tokenOrOptions - Injection token, or {@link RegisterDrizzleOptions}
 * @returns The transaction-aware handle (the same object `@InjectDB()` yields)
 *
 * @example
 * ```ts
 * registerDrizzle(app, db);                    // inject with @InjectDB()
 * registerDrizzle(app, db, 'myDb');             // inject with @Depends('myDb')
 * registerDrizzle(app, db, Symbol('readDb'));   // inject with @Depends(Symbol('readDb'))
 * registerDrizzle(app, db, {
 *   transactionPerRequest: (c) => c.req.method !== 'GET',
 * });
 * ```
 */
export function registerDrizzle<T>(
  app: VeloceTS,
  db: T,
  tokenOrOptions: string | symbol | RegisterDrizzleOptions = DB_TOKEN
): T {
  const options: RegisterDrizzleOptions =
    typeof tokenOrOptions === 'object' && tokenOrOptions !== null ? tokenOrOptions : { token: tokenOrOptions };
  const token = options.token ?? DB_TOKEN;

  // Only objects can be wrapped; anything else is registered as given.
  const handle: T =
    typeof db === 'object' && db !== null
      ? (createTransactionalDb(db as unknown as object, { onBegin: options.onBegin }) as unknown as T)
      : db;

  app.getContainer().register(token as any, {
    scope: 'singleton',
    factory: () => handle,
  });

  const perRequest = options.transactionPerRequest;
  if (perRequest || options.onBegin) {
    // afterPlugins: the request is authenticated (and any tenant resolved by
    // application middleware of the same phase registered earlier) by the time
    // the transaction begins.
    app.use(
      async (c, next) => {
        const wrap =
          typeof perRequest === 'function' ? perRequest(c) : perRequest === true;
        const streaming = (c.req.header('accept') ?? '').includes('text/event-stream');

        if (!wrap || streaming) {
          // No request-wide transaction, but transactions started during the
          // request still get `c` in onBegin.
          return runWithRequest(c, () => next());
        }

        await runWithRequest(c, async () => {
          try {
            await runInTransaction(handle as unknown as object, async () => {
              await next();
              // Errors thrown by the handler were already turned into a
              // response; they do not propagate here. Roll back on those, and
              // on any 5xx.
              if (c.get('veloce:error') || c.res.status >= 500) {
                throw new RollbackSignal();
              }
            });
          } catch (error) {
            if (!(error instanceof RollbackSignal)) throw error;
          }
        });
      },
      { phase: 'afterPlugins' }
    );
  }

  return handle;
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
