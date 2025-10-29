import { z } from 'zod';

// TypeORM-specific types and interfaces
export interface TypeORMConfig {
  type: 'mysql' | 'postgres' | 'sqlite' | 'mariadb' | 'mssql' | 'oracle' | 'mongodb';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  url?: string;
  synchronize?: boolean;
  logging?: boolean | 'all' | ('query' | 'error' | 'schema' | 'warn' | 'info' | 'log')[];
  entities?: string[] | Function[];
  migrations?: string[];
  subscribers?: string[];
  migrationsRun?: boolean;
  dropSchema?: boolean;
  cache?: boolean;
  ssl?: boolean | any;
  extra?: any;
}

export interface TypeORMEntityMetadata {
  name: string;
  tableName: string;
  columns: TypeORMColumnMetadata[];
  relations: TypeORMRelationMetadata[];
  zodSchema?: z.ZodSchema;
}

export interface TypeORMColumnMetadata {
  propertyName: string;
  type: string;
  isPrimary: boolean;
  isGenerated: boolean;
  isNullable: boolean;
  isUnique: boolean;
  length?: number;
  default?: any;
}

export interface TypeORMRelationMetadata {
  propertyName: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  target: string;
  inverseSide?: string;
  joinColumn?: string;
  joinTable?: string;
}

// TypeORM interfaces (generic to avoid direct dependency)
export interface DataSourceLike {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  isInitialized: boolean;
  manager: EntityManagerLike;
  transaction<T>(runInTransaction: (manager: EntityManagerLike) => Promise<T>): Promise<T>;
  createQueryRunner(): QueryRunnerLike;
  getRepository<T>(target: any): RepositoryLike<T>;
  getMetadata(target: any): any;
  runMigrations?(): Promise<void>;
  undoLastMigration?(): Promise<void>;
  synchronize?(): Promise<void>;
  dropDatabase?(): Promise<void>;
  entityMetadatas?: any[];
}

export interface EntityManagerLike {
  save<T>(entity: T): Promise<T>;
  save<T>(entities: T[]): Promise<T[]>;
  remove<T>(entity: T): Promise<T>;
  remove<T>(entities: T[]): Promise<T[]>;
  find<T>(entityClass: any, options?: any): Promise<T[]>;
  findOne<T>(entityClass: any, options?: any): Promise<T | null>;
  findOneBy<T>(entityClass: any, where: any): Promise<T | null>;
  count<T>(entityClass: any, options?: any): Promise<number>;
  create<T>(entityClass: any, entityLike?: any): T;
  merge<T>(entityClass: any, mergeIntoEntity: T, ...entityLikes: any[]): T;
  query(query: string, parameters?: any[]): Promise<any>;
  transaction<T>(runInTransaction: (manager: EntityManagerLike) => Promise<T>): Promise<T>;
  getRepository<T>(target: any): RepositoryLike<T>;
  connection?: {
    entityMetadatas?: any[];
  };
}

export interface RepositoryLike<T> {
  save(entity: T): Promise<T>;
  save(entities: T[]): Promise<T[]>;
  remove(entity: T): Promise<T>;
  remove(entities: T[]): Promise<T[]>;
  find(options?: any): Promise<T[]>;
  findOne(options?: any): Promise<T | null>;
  findOneBy(where: any): Promise<T | null>;
  count(options?: any): Promise<number>;
  create(entityLike?: any): T;
  merge(mergeIntoEntity: T, ...entityLikes: any[]): T;
  createQueryBuilder(alias?: string): QueryBuilderLike<T>;
  delete(criteria: any): Promise<{ affected?: number }>;
  update(criteria: any, partialEntity: any): Promise<{ affected?: number }>;
}

export interface QueryBuilderLike<T> {
  select(selection?: string | string[]): this;
  where(where: string, parameters?: any): this;
  andWhere(where: string, parameters?: any): this;
  orWhere(where: string, parameters?: any): this;
  orderBy(sort: string, order?: 'ASC' | 'DESC'): this;
  addOrderBy(sort: string, order?: 'ASC' | 'DESC'): this;
  groupBy(groupBy: string): this;
  having(having: string, parameters?: any): this;
  limit(limit: number): this;
  offset(offset: number): this;
  skip(skip: number): this;
  take(take: number): this;
  leftJoin(property: string, alias: string, condition?: string): this;
  innerJoin(property: string, alias: string, condition?: string): this;
  insert(): InsertQueryBuilderLike<T>;
  getMany(): Promise<T[]>;
  getOne(): Promise<T | null>;
  getCount(): Promise<number>;
  getManyAndCount(): Promise<[T[], number]>;
}

export interface InsertQueryBuilderLike<T> {
  into(target: any): this;
  values(values: any | any[]): this;
  execute(): Promise<any>;
}

export interface QueryRunnerLike {
  connect(): Promise<void>;
  release(): Promise<void>;
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  isTransactionActive: boolean;
  manager: EntityManagerLike;
}

// TypeORM repository options
export interface TypeORMRepositoryOptions<T> {
  entity: any;
  dataSource: DataSourceLike;
  repository: RepositoryLike<T>;
  zodSchema?: z.ZodSchema<T>;
}