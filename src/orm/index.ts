/**
 * @module veloce-ts/orm
 * @description Abstraction layer over repositories, pagination, transactions and plugins (Drizzle, Prisma, TypeORM).
 */
export * from './errors.js';
export * from './base-repository.js';
export * from './repository-factory.js';
export * from './query-builder.js';
export * from './pagination.js';

// Transaction Management
export type {
  TransactionContext,
  ITransactionManager
} from './transaction-manager.js';

export {
  BaseTransactionManager,
  InMemoryTransactionManager,
  getGlobalTransactionManager,
  setGlobalTransactionManager
} from './transaction-manager.js';

export type {
  TransactionMetadata,
  RepositoryMetadata
} from './decorators.js';

export {
  Repository,
  Transactional,
  Entity,
  Column
} from './decorators.js';

export * from './transaction-interceptor.js';
export * from './transaction-propagation.js';
export * from './transaction-events.js';
export * from './transaction-plugin.js';

// ORM Integrations
export * from './prisma/index.js';
export * from './typeorm/index.js';
export * from './drizzle/index.js';