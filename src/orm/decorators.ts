import 'reflect-metadata';
import { MetadataRegistry } from '../core/metadata.js';
import { getGlobalTransactionManager } from './transaction-manager.js';
import { isTransactionalDb, runInTransaction } from './transaction-context.js';

/**
 * The transaction-aware database handle held by `instance` (what `@InjectDB()`
 * injects after `registerDrizzle()`), if it holds exactly one.
 */
function findTransactionalDb(instance: any, property?: string): object | undefined {
  if (!instance || typeof instance !== 'object') return undefined;

  if (property) {
    const candidate = instance[property];
    return isTransactionalDb(candidate) ? candidate : undefined;
  }

  let found: object | undefined;
  for (const key of Object.keys(instance)) {
    const value = instance[key];
    if (!isTransactionalDb(value)) continue;
    if (found && found !== value) {
      throw new Error(
        `@Transactional: ${instance.constructor?.name ?? 'instance'} holds more than one database handle. ` +
        "Say which one with @Transactional({ db: 'propertyName' })."
      );
    }
    found = value;
  }
  return found;
}

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
  /**
   * Name of the property holding the database handle, when the class has more
   * than one. Only needed with handles registered through `registerDrizzle()`.
   */
  db?: string;
  /**
   * When a transaction is already active: `false` (default) joins it, `true`
   * opens a savepoint so this method can fail without aborting the caller's
   * transaction. Only applies to handles registered through `registerDrizzle()`.
   */
  nested?: boolean;
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
 * Run a method inside a database transaction: committed when it resolves,
 * rolled back when it throws.
 *
 * With a database registered through `registerDrizzle()` and injected with
 * `@InjectDB()`, every query the method makes through that handle — directly or
 * in services it awaits — is part of the transaction; nothing has to be passed
 * around. When a transaction is already active the method joins it.
 *
 * @example
 * ```ts
 * class GradesService {
 *   constructor(@InjectDB() private db: DB) {}
 *
 *   @Transactional()
 *   async saveAll(rows: Grade[]) {
 *     for (const row of rows) await this.db.insert(grades).values(row);
 *   }
 * }
 * ```
 *
 * Classes that do not hold such a handle fall back to the global transaction
 * manager (repositories, `TransactionPlugin`), as before.
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
    descriptor.value = async function (this: any, ...args: any[]) {
      // Ambient transaction: the instance holds a handle from registerDrizzle().
      const db = findTransactionalDb(this, options?.db);
      if (db) {
        return runInTransaction(db, () => originalMethod.apply(this, args), {
          nested: options?.nested === true,
        });
      }
      if (options?.db) {
        throw new Error(
          `@Transactional({ db: '${options.db}' }): this.${options.db} is not a database handle registered with registerDrizzle().`
        );
      }

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