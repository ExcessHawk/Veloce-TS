// TypeORM Integration
export { TypeORMPlugin, createTypeORMPlugin, Migration } from './plugin.js';
export { TypeORMRepository } from './repository.js';
export { TypeORMTransactionManager } from './transaction-manager.js';
export { TypeORMEntity } from './decorators.js';
export type { 
  TypeORMConfig, 
  TypeORMEntityMetadata, 
  TypeORMColumnMetadata, 
  TypeORMRelationMetadata, 
  TypeORMRepositoryOptions 
} from './types.js';