import 'reflect-metadata';
import { MetadataRegistry } from '../core/metadata';
import { getGlobalTransactionManager } from './transaction-manager';

// Repository decorator metadata
export interface RepositoryMetadata {
  entity?: any;
  connection?: string;
  transactional?: boolean;
}

// Transaction decorator metadata
export interface TransactionMetadata {
  isolation?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  timeout?: number;
  readOnly?: boolean;
  propagation?: 'REQUIRED' | 'REQUIRES_NEW' | 'SUPPORTS' | 'NOT_SUPPORTED' | 'NEVER' | 'MANDATORY';
}

/**
 * Repository decorator for marking classes as repositories
 */
export function Repository(entity?: any, connection?: string): ClassDecorator {
  return (target: any) => {
    const metadata: RepositoryMetadata = {
      entity,
      connection,
      transactional: false
    };
    
    Reflect.defineMetadata('repository', metadata, target);
  };
}

/**
 * Transactional decorator for automatic transaction management
 */
export function Transactional(options?: TransactionMetadata): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const metadata: TransactionMetadata = {
      isolation: options?.isolation || 'READ_COMMITTED',
      timeout: options?.timeout || 30000,
      readOnly: options?.readOnly || false,
      propagation: options?.propagation || 'REQUIRED'
    };
    
    // Store metadata for reflection
    Reflect.defineMetadata('transactional', metadata, target, propertyKey);
    
    // Wrap the original method with transaction logic
    descriptor.value = async function (...args: any[]) {
      const transactionManager = getGlobalTransactionManager();
      
      // Handle transaction based on propagation behavior
      return await transactionManager.handleTransactional(
        this,
        propertyKey as string,
        args,
        originalMethod,
        // Try to get context from arguments (if available)
        args.find(arg => arg && typeof arg === 'object' && arg.req && arg.res)
      );
    };
    
    return descriptor;
  };
}

/**
 * Entity decorator for marking classes as database entities
 */
export function Entity(tableName?: string): ClassDecorator {
  return (target: any) => {
    const metadata = {
      tableName: tableName || target.name.toLowerCase()
    };
    
    Reflect.defineMetadata('entity', metadata, target);
  };
}

/**
 * Column decorator for marking properties as database columns
 */
export function Column(options?: {
  name?: string;
  type?: string;
  nullable?: boolean;
  unique?: boolean;
  primary?: boolean;
}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata = {
      name: options?.name || propertyKey.toString(),
      type: options?.type || 'string',
      nullable: options?.nullable || false,
      unique: options?.unique || false,
      primary: options?.primary || false
    };
    
    Reflect.defineMetadata('column', metadata, target, propertyKey);
  };
}