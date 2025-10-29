// TypeORM Integration
export { TypeORMPlugin, createTypeORMPlugin, Migration } from './plugin';
export { TypeORMRepository } from './repository';
export { TypeORMTransactionManager } from './transaction-manager';
export { TypeORMEntity } from './decorators';
export type { 
  TypeORMConfig, 
  TypeORMEntityMetadata, 
  TypeORMColumnMetadata, 
  TypeORMRelationMetadata, 
  TypeORMRepositoryOptions 
} from './types';