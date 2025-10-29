// ORM Integration Layer
export * from './base-repository';
export * from './repository-factory';
export * from './query-builder';
export * from './pagination';

// Transaction Management
export type {
  TransactionContext,
  ITransactionManager
} from './transaction-manager';

export {
  BaseTransactionManager,
  InMemoryTransactionManager,
  getGlobalTransactionManager,
  setGlobalTransactionManager
} from './transaction-manager';

export type {
  TransactionMetadata,
  RepositoryMetadata
} from './decorators';

export {
  Repository,
  Transactional,
  Entity,
  Column
} from './decorators';

export * from './transaction-interceptor';
export * from './transaction-propagation';
export * from './transaction-events';
export * from './transaction-plugin';

// ORM Integrations
export * from './prisma';
export * from './typeorm';
export * from './drizzle';