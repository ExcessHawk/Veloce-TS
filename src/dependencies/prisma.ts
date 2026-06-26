/**
 * @module veloce-ts/dependencies/prisma
 * @description Register a Prisma client in the DI container (`registerPrisma`, `PRISMA_TOKEN`)
 * so controllers and services can receive it via `@Depends(PRISMA_TOKEN)` or `@InjectDB()`.
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { registerPrisma } from 'veloce-ts';
 *
 * const prisma = new PrismaClient();
 * registerPrisma(app, prisma);
 *
 * @Controller('/users')
 * class UserController {
 *   constructor(@Depends(PRISMA_TOKEN) private db: PrismaClient) {}
 *
 *   @Get('/')
 *   list() { return this.db.user.findMany(); }
 * }
 * ```
 */

import type { VeloceTS } from '../core/application';

/** Default injection token for a Prisma client registered with `registerPrisma()`. */
export const PRISMA_TOKEN = Symbol('veloce:prisma');

/**
 * Register a Prisma client instance in the application DI container.
 *
 * @param app    - VeloceTS application instance
 * @param client - PrismaClient instance (or any Prisma-compatible object)
 * @param token  - Optional injection token; defaults to `PRISMA_TOKEN`
 *
 * @example
 * ```ts
 * registerPrisma(app, prisma);                        // inject with @Depends(PRISMA_TOKEN)
 * registerPrisma(app, prisma, Symbol('readPrisma'));   // inject with @Depends(Symbol('readPrisma'))
 * ```
 */
export function registerPrisma<T>(
  app: VeloceTS,
  client: T,
  token: string | symbol = PRISMA_TOKEN
): void {
  app.getContainer().register(token as any, {
    scope: 'singleton',
    factory: () => client,
  });
}
