/**
 * @module veloce-ts/dependencies/typeorm
 * @description Register a TypeORM DataSource in the DI container (`registerTypeORM`, `TYPEORM_TOKEN`)
 * so controllers and services can receive it via `@Depends(TYPEORM_TOKEN)`.
 *
 * @example
 * ```ts
 * import { DataSource } from 'typeorm';
 * import { registerTypeORM } from 'veloce-ts';
 *
 * const dataSource = new DataSource({ type: 'sqlite', database: 'app.db', entities: [...] });
 * await dataSource.initialize();
 * registerTypeORM(app, dataSource);
 *
 * @Controller('/users')
 * class UserController {
 *   constructor(@Depends(TYPEORM_TOKEN) private ds: DataSource) {}
 *
 *   @Get('/')
 *   list() { return this.ds.getRepository(User).find(); }
 * }
 * ```
 */

import type { VeloceTS } from '../core/application';

/** Default injection token for a TypeORM DataSource registered with `registerTypeORM()`. */
export const TYPEORM_TOKEN = Symbol('veloce:typeorm');

/**
 * Register a TypeORM DataSource in the application DI container.
 *
 * @param app        - VeloceTS application instance
 * @param dataSource - TypeORM DataSource instance (already initialized)
 * @param token      - Optional injection token; defaults to `TYPEORM_TOKEN`
 *
 * @example
 * ```ts
 * registerTypeORM(app, dataSource);                        // inject with @Depends(TYPEORM_TOKEN)
 * registerTypeORM(app, dataSource, Symbol('readDb'));       // inject with @Depends(Symbol('readDb'))
 * ```
 */
export function registerTypeORM<T>(
  app: VeloceTS,
  dataSource: T,
  token: string | symbol = TYPEORM_TOKEN
): void {
  app.getContainer().register(token as any, {
    scope: 'singleton',
    factory: () => dataSource,
  });
}
