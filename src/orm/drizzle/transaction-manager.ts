import { BaseTransactionManager, TransactionContext, TransactionMetadata } from '../transaction-manager';
import { DrizzleDatabase } from './types';

/**
 * Drizzle-specific transaction manager
 */
export class DrizzleTransactionManager extends BaseTransactionManager {
  private database: DrizzleDatabase;
  private drizzleTransactions = new Map<string, any>();
  
  constructor(database: DrizzleDatabase) {
    super();
    this.database = database;
  }
  
  async begin(options?: TransactionMetadata): Promise<TransactionContext> {
    const context = this.createTransactionContext(options);
    
    // Drizzle handles transactions through the transaction method
    // We'll track the context for nested transaction support
    this.drizzleTransactions.set(context.id, {
      options,
      startTime: context.startTime
    });
    
    return context;
  }
  
  async commit(context: TransactionContext): Promise<void> {
    // In Drizzle, commits are handled automatically by the transaction method
    // We just need to clean up our tracking
    this.drizzleTransactions.delete(context.id);
    this.removeTransactionContext(context);
  }
  
  async rollback(context: TransactionContext): Promise<void> {
    // In Drizzle, rollbacks are handled automatically by the transaction method
    // when an error is thrown. We just need to clean up our tracking
    this.drizzleTransactions.delete(context.id);
    this.removeTransactionContext(context);
  }
  
  async savepoint(context: TransactionContext, name: string): Promise<void> {
    // Drizzle doesn't have explicit savepoint support in the API
    // We'll simulate this by tracking savepoint names
    context.savepoints.push(name);
    
    const transaction = this.drizzleTransactions.get(context.id);
    if (transaction) {
      transaction.savepoints = transaction.savepoints || [];
      transaction.savepoints.push(name);
    }
  }
  
  async rollbackToSavepoint(context: TransactionContext, name: string): Promise<void> {
    // Drizzle doesn't have explicit rollback to savepoint support
    // We'll simulate this by tracking the savepoint state
    const index = context.savepoints.indexOf(name);
    if (index === -1) {
      throw new Error(`Savepoint ${name} not found`);
    }
    
    // Remove savepoints after the target savepoint
    context.savepoints = context.savepoints.slice(0, index + 1);
    
    const transaction = this.drizzleTransactions.get(context.id);
    if (transaction && transaction.savepoints) {
      transaction.savepoints = transaction.savepoints.slice(0, index + 1);
    }
  }
  
  /**
   * Execute a function within a Drizzle transaction
   */
  async executeInTransaction<T>(
    callback: (db: DrizzleDatabase) => Promise<T>,
    options?: TransactionMetadata
  ): Promise<T> {
    return await this.database.transaction(async (tx) => {
      return await callback(tx);
    });
  }
  
  /**
   * Enhanced transaction handler that integrates with Drizzle's transaction system
   */
  async handleTransactional<T>(
    target: any,
    propertyKey: string,
    args: any[],
    originalMethod: Function,
    context?: any
  ): Promise<T> {
    const metadata = Reflect.getMetadata('transactional', target, propertyKey) as TransactionMetadata;
    
    if (!metadata) {
      return originalMethod.apply(target, args);
    }
    
    // Check if we're already in a Drizzle transaction
    const existingTransaction = context ? this.getRequestTransaction(context) : null;
    
    if (existingTransaction) {
      // We're already in a transaction, just execute the method
      return originalMethod.apply(target, args);
    }
    
    // Start new Drizzle transaction
    return await this.executeInTransaction(async (tx) => {
      // Create transaction context for tracking
      const transactionContext = await this.begin(metadata);
      
      if (context) {
        this.setRequestTransaction(context, transactionContext);
      }
      
      try {
        // Inject the transaction database into repositories if needed
        const result = await this.injectTransactionDatabase(target, args, originalMethod, tx);
        
        if (transactionContext.rollbackOnly) {
          throw new Error('Transaction marked for rollback');
        }
        
        return result;
      } catch (error) {
        // Mark transaction for rollback
        this.setRollbackOnly(transactionContext);
        throw error;
      } finally {
        if (context) {
          this.clearRequestTransaction(context);
        }
        await this.commit(transactionContext);
      }
    }, metadata);
  }
  
  /**
   * Inject transaction database into repositories
   */
  private async injectTransactionDatabase(
    target: any,
    args: any[],
    originalMethod: Function,
    transactionDatabase: DrizzleDatabase
  ): Promise<any> {
    // If the target has repositories, update them to use the transaction database
    if (target.repositories) {
      const originalRepositories = { ...target.repositories };
      
      try {
        // Update repositories to use transaction database
        for (const [key, repo] of Object.entries(target.repositories)) {
          if (repo && typeof repo === 'object' && 'database' in repo) {
            // Create a new repository instance with the transaction database
            const table = (repo as any).table;
            const zodSchema = (repo as any).schema;
            
            target.repositories[key] = new (repo.constructor as any)({
              database: transactionDatabase,
              table: table,
              zodSchema: zodSchema
            });
          }
        }
        
        return await originalMethod.apply(target, args);
      } finally {
        // Restore original repositories
        target.repositories = originalRepositories;
      }
    }
    
    return await originalMethod.apply(target, args);
  }
  
  /**
   * Create a repository with transaction support
   */
  createTransactionalRepository<T>(
    repositoryClass: new (...args: any[]) => T,
    options: any
  ): T {
    const repository = new repositoryClass(options);
    
    // Override the withTransaction method to use Drizzle's transaction system
    if (repository && typeof repository === 'object' && 'withTransaction' in repository) {
      const originalWithTransaction = (repository as any).withTransaction;
      
      (repository as any).withTransaction = async <R>(callback: (repo: T) => Promise<R>): Promise<R> => {
        return await this.executeInTransaction(async (tx) => {
          // Create a new repository instance with the transaction database
          const transactionalRepo = new repositoryClass({
            ...options,
            database: tx
          });
          
          return await callback(transactionalRepo);
        });
      };
    }
    
    return repository;
  }
  
  /**
   * Execute multiple operations in a single transaction
   */
  async batch<T extends readonly unknown[]>(
    operations: readonly [...{ [K in keyof T]: () => Promise<T[K]> }]
  ): Promise<T> {
    return await this.executeInTransaction(async (tx) => {
      const results: any[] = [];
      
      for (const operation of operations) {
        const result = await operation();
        results.push(result);
      }
      
      return results as unknown as T;
    });
  }
  
  /**
   * Execute operations with retry logic
   */
  async executeWithRetry<T>(
    operation: (db: DrizzleDatabase) => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      retryCondition?: (error: any) => boolean;
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      retryDelay = 1000,
      retryCondition = (error) => error.code === 'SERIALIZATION_FAILURE' || error.code === 'DEADLOCK_DETECTED'
    } = options;
    
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeInTransaction(operation);
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !retryCondition(error)) {
          throw error;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
      }
    }
    
    throw lastError;
  }
  
  /**
   * Get the database instance
   */
  getDatabase(): DrizzleDatabase {
    return this.database;
  }
  
  /**
   * Check if currently in a transaction
   */
  isInTransaction(): boolean {
    return this.drizzleTransactions.size > 0;
  }
  
  /**
   * Get active transaction count
   */
  getActiveTransactionCount(): number {
    return this.drizzleTransactions.size;
  }
}