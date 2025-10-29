import { BaseTransactionManager, TransactionContext, TransactionMetadata } from '../transaction-manager';
import { PrismaClientLike } from './types';

/**
 * Prisma-specific transaction manager
 */
export class PrismaTransactionManager extends BaseTransactionManager {
  private client: PrismaClientLike;
  private prismaTransactions = new Map<string, any>();
  
  constructor(client: PrismaClientLike) {
    super();
    this.client = client;
  }
  
  async begin(options?: TransactionMetadata): Promise<TransactionContext> {
    const context = this.createTransactionContext(options);
    
    // Prisma doesn't support explicit begin/commit/rollback
    // Instead, we'll use the $transaction method when needed
    // For now, we'll just track the context
    this.prismaTransactions.set(context.id, {
      options,
      startTime: context.startTime
    });
    
    return context;
  }
  
  async commit(context: TransactionContext): Promise<void> {
    // In Prisma, commits are handled automatically by the $transaction method
    // We just need to clean up our tracking
    this.prismaTransactions.delete(context.id);
    this.removeTransactionContext(context);
  }
  
  async rollback(context: TransactionContext): Promise<void> {
    // In Prisma, rollbacks are handled automatically by the $transaction method
    // when an error is thrown. We just need to clean up our tracking
    this.prismaTransactions.delete(context.id);
    this.removeTransactionContext(context);
  }
  
  async savepoint(context: TransactionContext, name: string): Promise<void> {
    // Prisma doesn't support explicit savepoints
    // We'll simulate this by tracking savepoint names
    context.savepoints.push(name);
    
    const transaction = this.prismaTransactions.get(context.id);
    if (transaction) {
      transaction.savepoints = transaction.savepoints || [];
      transaction.savepoints.push(name);
    }
  }
  
  async rollbackToSavepoint(context: TransactionContext, name: string): Promise<void> {
    // Prisma doesn't support explicit rollback to savepoint
    // We'll simulate this by tracking the savepoint state
    const index = context.savepoints.indexOf(name);
    if (index === -1) {
      throw new Error(`Savepoint ${name} not found`);
    }
    
    // Remove savepoints after the target savepoint
    context.savepoints = context.savepoints.slice(0, index + 1);
    
    const transaction = this.prismaTransactions.get(context.id);
    if (transaction && transaction.savepoints) {
      transaction.savepoints = transaction.savepoints.slice(0, index + 1);
    }
  }
  
  /**
   * Execute a function within a Prisma transaction
   */
  async executeInTransaction<T>(
    callback: (client: PrismaClientLike) => Promise<T>,
    options?: TransactionMetadata
  ): Promise<T> {
    const prismaOptions: any = {};
    
    if (options?.timeout) {
      prismaOptions.timeout = options.timeout;
    }
    
    if (options?.isolation) {
      // Map our isolation levels to Prisma's
      const isolationMap = {
        'READ_UNCOMMITTED': 'ReadUncommitted',
        'READ_COMMITTED': 'ReadCommitted',
        'REPEATABLE_READ': 'RepeatableRead',
        'SERIALIZABLE': 'Serializable'
      };
      prismaOptions.isolationLevel = isolationMap[options.isolation];
    }
    
    return await this.client.$transaction(callback, prismaOptions);
  }
  
  /**
   * Enhanced transaction handler that integrates with Prisma's transaction system
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
    
    // Check if we're already in a Prisma transaction
    const existingTransaction = context ? this.getRequestTransaction(context) : null;
    
    if (existingTransaction) {
      // We're already in a transaction, just execute the method
      return originalMethod.apply(target, args);
    }
    
    // Start new Prisma transaction
    return await this.executeInTransaction(async (prismaClient) => {
      // Create transaction context for tracking
      const transactionContext = await this.begin(metadata);
      
      if (context) {
        this.setRequestTransaction(context, transactionContext);
      }
      
      try {
        // Inject the transaction client into repositories if needed
        const result = await this.injectTransactionClient(target, args, originalMethod, prismaClient);
        
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
   * Inject transaction client into repositories
   */
  private async injectTransactionClient(
    target: any,
    args: any[],
    originalMethod: Function,
    transactionClient: PrismaClientLike
  ): Promise<any> {
    // If the target has repositories, update them to use the transaction client
    if (target.repositories) {
      const originalRepositories = { ...target.repositories };
      
      try {
        // Update repositories to use transaction client
        for (const [key, repo] of Object.entries(target.repositories)) {
          if (repo && typeof repo === 'object' && 'client' in repo) {
            (repo as any).client = transactionClient;
            
            // Update delegate if it exists
            const modelName = (repo as any).modelName;
            if (modelName && (transactionClient as any)[modelName.toLowerCase()]) {
              (repo as any).delegate = (transactionClient as any)[modelName.toLowerCase()];
            }
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
    
    // Override the withTransaction method to use Prisma's transaction system
    if (repository && typeof repository === 'object' && 'withTransaction' in repository) {
      const originalWithTransaction = (repository as any).withTransaction;
      
      (repository as any).withTransaction = async <R>(callback: (repo: T) => Promise<R>): Promise<R> => {
        return await this.executeInTransaction(async (transactionClient) => {
          // Create a new repository instance with the transaction client
          const transactionalRepo = new repositoryClass({
            ...options,
            client: transactionClient,
            delegate: (transactionClient as any)[options.model.toLowerCase()]
          });
          
          return await callback(transactionalRepo);
        });
      };
    }
    
    return repository;
  }
}