import 'reflect-metadata';

/**
 * TypeORM-specific decorators for FastAPI-TS integration
 */

// Entity decorator metadata
export interface TypeORMEntityMetadata {
  name?: string;
  tableName?: string;
  schema?: string;
  database?: string;
  synchronize?: boolean;
}

// Repository decorator metadata
export interface TypeORMRepositoryMetadata {
  entity: any;
  dataSource?: string;
}

/**
 * Enhanced Entity decorator for TypeORM integration
 */
export function TypeORMEntity(options?: TypeORMEntityMetadata): ClassDecorator {
  return (target: any) => {
    const metadata: TypeORMEntityMetadata = {
      name: options?.name || target.name,
      tableName: options?.tableName || target.name.toLowerCase(),
      schema: options?.schema,
      database: options?.database,
      synchronize: options?.synchronize
    };
    
    Reflect.defineMetadata('typeorm:entity', metadata, target);
  };
}

/**
 * TypeORM Repository decorator for dependency injection
 */
export function TypeORMRepository(entity: any, dataSource?: string): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: TypeORMRepositoryMetadata = {
      entity,
      dataSource
    };
    
    Reflect.defineMetadata('typeorm:repository', metadata, target, propertyKey);
  };
}

/**
 * InjectDataSource decorator for injecting TypeORM DataSource
 */
export function InjectDataSource(name?: string): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata = {
      type: 'typeorm-datasource',
      name: name || 'default'
    };
    
    Reflect.defineMetadata('inject', metadata, target, propertyKey);
  };
}

/**
 * InjectEntityManager decorator for injecting TypeORM EntityManager
 */
export function InjectEntityManager(dataSource?: string): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata = {
      type: 'typeorm-entity-manager',
      dataSource: dataSource || 'default'
    };
    
    Reflect.defineMetadata('inject', metadata, target, propertyKey);
  };
}

/**
 * Migration decorator for marking classes as migrations
 */
export function Migration(timestamp: number): ClassDecorator {
  return (target: any) => {
    const metadata = {
      timestamp,
      name: target.name
    };
    
    Reflect.defineMetadata('typeorm:migration', metadata, target);
  };
}

/**
 * Subscriber decorator for marking classes as entity subscribers
 */
export function Subscriber(): ClassDecorator {
  return (target: any) => {
    const metadata = {
      name: target.name
    };
    
    Reflect.defineMetadata('typeorm:subscriber', metadata, target);
  };
}