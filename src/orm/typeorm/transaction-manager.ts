import { BaseTransactionManager, TransactionContext, TransactionMetadata } from '../transaction-manager';
import { DataSourceLike, EntityManagerLike, QueryRunnerLike } from './types';

/**
 * TypeORM-specific transaction manager
 */
export class TypeORMTransactionManager extends BaseTransactionManager {
  private dataSource: DataSourceLike;
  private activeQueryRunners = new Map<string, QueryRunnerLike>();
  
  constructor(dataSource: DataSourceLike) {
    super();
    this.dataSource = dataSource;
  }
  
  async begin(options?: TransactionMetadata): Promise<TransactionContext> {
    const context = this.createTransactionContext(options);
    
    // Create query runner for this transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    this.activeQueryRunners.set(context.id, queryRunner);
    
    return context;
  }
  
  async commit(context: TransactionContext): Promise<void> {
    const queryRunner = this.activeQueryRunners.get(context.id);
    if (!queryRunner) {
      throw new Error(`Transaction ${context.id} not found`);
    }
    
    try {
      if (context.rollbackOnly) {
        await queryRunner.rollbackTransaction();
      } else {
        await queryRunner.commitTransaction();
      }
    } finally {
      await queryRunner.release();
      this.activeQueryRunners.delete(context.id);
      this.removeTransactionContext(context);
    }
  }
  
  async rollback(context: TransactionContext): Promise<void> {
    const queryRunner = this.activeQueryRunners.get(context.id);
    if (!queryRunner) {
      throw new Error(`Transaction ${context.id} not found`);
    }
    
    try {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
    } finally {
      await queryRunner.release();
      this.activeQueryRunners.delete(context.id);
      this.removeTransactionContext(context);
    }
  }
  
  async savepoint(context: TransactionContext, name: string): Promise<void> {
    const queryRunner = this.activeQueryRunners.get(context.id);
    if (!queryRunner) {
      throw new Error(`Transaction ${context.id} not found`);
    }
    
    // Execute savepoint SQL
    await queryRunner.manager.query(`SAVEPOINT ${name}`);
    context.savepoints.push(name);
  }
  
  async rollbackToSavepoint(context: TransactionContext, name: string): Promise<void> {
    const queryRunner = this.activeQueryRunners.get(context.id);
    if (!queryRunner) {
      throw new Error(`Transaction ${context.id} not found`);
    }
    
    const index = context.savepoints.indexOf(name);
    if (index === -1) {
      throw new Error(`Savepoint ${name} not found`);
    }
    
    // Execute rollback to savepoint SQL
    await queryRunner.manager.query(`ROLLBACK TO SAVEPOINT ${name}`);
    
    // Remove savepoints after the target savepoint
    context.savepoints = context.savepoints.slice(0, index + 1);
  }
  
  /**
   * Execute a function within a TypeORM transaction
   */
  async executeInTransaction<T>(
    callback: (manager: EntityManagerLike) => Promise<T>,
    options?: TransactionMetadata
  ): Promise<T> {
    return await this.dataSource.transaction(async (manager: EntityManagerLike) => {
      return await callback(manager);
    });
  }
  
  /**
   * Enhanced transaction handler that integrates with TypeORM's transaction system
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
    
    // Check if we're already in a TypeORM transaction
    const existingTransaction = context ? this.getRequestTransaction(context) : null;
    
    if (existingTransaction) {
      // Use existing transaction (nested transaction support with savepoints)
      return this.handleNestedTransaction(existingTransaction, target, args, originalMethod);
    }
    
    // Start new TypeORM transaction
    return await this.executeInTransaction(async (manager) => {
      // Create transaction context for tracking
      const transactionContext = await this.begin(metadata);
      
      if (context) {
        this.setRequestTransaction(context, transactionContext);
      }
      
      try {
        // Inject the transaction manager into repositories if needed
        const result = await this.injectTransactionManager(target, args, originalMethod, manager);
        
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
        // Note: commit/rollback is handled by TypeORM's transaction method
        this.removeTransactionContext(transactionContext);
      }
    }, metadata);
  }
  
  /**
   * Handle nested transactions using savepoints
   */
  protected async handleNestedTransaction<T>(
    parentTransaction: TransactionContext,
    target: any,
    args: any[],
    originalMethod: Function
  ): Promise<T> {
    // Create savepoint for nested transaction
    const savepointName = `sp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    try {
      await this.savepoint(parentTransaction, savepointName);
      const result = await originalMethod.apply(target, args);
      return result;
    } catch (error) {
      await this.rollbackToSavepoint(parentTransaction, savepointName);
      throw error;
    }
  }
  
  /**
   * Inject transaction manager into repositories
   */
  private async injectTransactionManager(
    target: any,
    args: any[],
    originalMethod: Function,
    transactionManager: EntityManagerLike
  ): Promise<any> {
    // If the target has repositories, update them to use the transaction manager
    if (target.repositories) {
      const originalRepositories = { ...target.repositories };
      
      try {
        // Update repositories to use transaction manager
        for (const [key, repo] of Object.entries(target.repositories)) {
          if (repo && typeof repo === 'object' && 'dataSource' in repo) {
            // Create a new repository instance with the transaction manager
            const entity = (repo as any).entity;
            const transactionalRepo = transactionManager.getRepository ? 
              transactionManager.getRepository(entity) : 
              (repo as any).repository;
            
            // Replace the repository with the transactional one
            target.repositories[key] = new (repo.constructor as any)({
              dataSource: (repo as any).dataSource,
              repository: transactionalRepo,
              entity: entity,
              zodSchema: (repo as any).schema
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
    
    // Override the withTransaction method to use TypeORM's transaction system
    if (repository && typeof repository === 'object' && 'withTransaction' in repository) {
      const originalWithTransaction = (repository as any).withTransaction;
      
      (repository as any).withTransaction = async <R>(callback: (repo: T) => Promise<R>): Promise<R> => {
        return await this.executeInTransaction(async (manager) => {
          // Create a new repository instance with the transaction manager
          const transactionalRepo = manager.getRepository ? 
            manager.getRepository(options.entity) : 
            options.repository;
          const transactionalInstance = new repositoryClass({
            ...options,
            repository: transactionalRepo
          });
          
          return await callback(transactionalInstance);
        });
      };
    }
    
    return repository;
  }
  
  /**
   * Get query runner for a transaction context
   */
  getQueryRunner(context: TransactionContext): QueryRunnerLike | undefined {
    return this.activeQueryRunners.get(context.id);
  }
  
  /**
   * Check if a transaction is active
   */
  isTransactionActive(context: TransactionContext): boolean {
    const queryRunner = this.activeQueryRunners.get(context.id);
    return queryRunner ? queryRunner.isTransactionActive : false;
  }
  
  /**
   * Get the data source
   */
  getDataSource(): DataSourceLike {
    return this.dataSource;
  }
}