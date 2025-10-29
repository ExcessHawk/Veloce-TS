import { Context } from 'hono';

// Transaction metadata interface
export interface TransactionMetadata {
  isolation?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  timeout?: number;
  readOnly?: boolean;
  propagation?: 'REQUIRED' | 'REQUIRES_NEW' | 'SUPPORTS' | 'NOT_SUPPORTED' | 'NEVER' | 'MANDATORY';
}

// Transaction context interface
export interface TransactionContext {
  id: string;
  startTime: Date;
  isolation?: string;
  timeout?: number;
  readOnly?: boolean;
  savepoints: string[];
  rollbackOnly: boolean;
}

// Transaction manager interface
export interface ITransactionManager {
  begin(options?: TransactionMetadata): Promise<TransactionContext>;
  commit(context: TransactionContext): Promise<void>;
  rollback(context: TransactionContext): Promise<void>;
  savepoint(context: TransactionContext, name: string): Promise<void>;
  rollbackToSavepoint(context: TransactionContext, name: string): Promise<void>;
  isActive(context: TransactionContext): boolean;
  setRollbackOnly(context: TransactionContext): void;
  handleTransactional<T>(
    target: any,
    propertyKey: string,
    args: any[],
    originalMethod: Function,
    context?: Context
  ): Promise<T>;
}

/**
 * Base transaction manager implementation
 */
export abstract class BaseTransactionManager implements ITransactionManager {
  private activeTransactions = new Map<string, TransactionContext>();
  private requestTransactions = new WeakMap<Context, TransactionContext>();
  
  abstract begin(options?: TransactionMetadata): Promise<TransactionContext>;
  abstract commit(context: TransactionContext): Promise<void>;
  abstract rollback(context: TransactionContext): Promise<void>;
  abstract savepoint(context: TransactionContext, name: string): Promise<void>;
  abstract rollbackToSavepoint(context: TransactionContext, name: string): Promise<void>;
  
  isActive(context: TransactionContext): boolean {
    return this.activeTransactions.has(context.id);
  }
  
  setRollbackOnly(context: TransactionContext): void {
    context.rollbackOnly = true;
  }
  
  protected createTransactionContext(options?: TransactionMetadata): TransactionContext {
    const context: TransactionContext = {
      id: crypto.randomUUID(),
      startTime: new Date(),
      isolation: options?.isolation,
      timeout: options?.timeout,
      readOnly: options?.readOnly,
      savepoints: [],
      rollbackOnly: false
    };
    
    this.activeTransactions.set(context.id, context);
    return context;
  }
  
  protected removeTransactionContext(context: TransactionContext): void {
    this.activeTransactions.delete(context.id);
  }
  
  // Request-scoped transaction management
  getRequestTransaction(request: Context): TransactionContext | undefined {
    return this.requestTransactions.get(request);
  }
  
  setRequestTransaction(request: Context, context: TransactionContext): void {
    this.requestTransactions.set(request, context);
  }
  
  clearRequestTransaction(request: Context): void {
    this.requestTransactions.delete(request);
  }
  
  // Transaction decorator handler
  async handleTransactional<T>(
    target: any,
    propertyKey: string,
    args: any[],
    originalMethod: Function,
    context?: Context
  ): Promise<T> {
    const metadata = Reflect.getMetadata('transactional', target, propertyKey) as TransactionMetadata;
    
    if (!metadata) {
      return originalMethod.apply(target, args);
    }
    
    // Check if we're already in a transaction
    const existingTransaction = context ? this.getRequestTransaction(context) : null;
    
    // Handle different propagation behaviors
    const propagation = metadata.propagation || 'REQUIRED';
    
    switch (propagation) {
      case 'REQUIRED':
        return existingTransaction 
          ? this.executeInExistingTransaction(existingTransaction, target, args, originalMethod, metadata)
          : this.executeInNewTransaction(target, args, originalMethod, metadata, context);
      
      case 'REQUIRES_NEW':
        return this.executeInNewTransaction(target, args, originalMethod, metadata, context);
      
      case 'SUPPORTS':
        return existingTransaction
          ? this.executeInExistingTransaction(existingTransaction, target, args, originalMethod, metadata)
          : originalMethod.apply(target, args);
      
      case 'NOT_SUPPORTED':
        // Execute without transaction, suspend existing if present
        return originalMethod.apply(target, args);
      
      case 'MANDATORY':
        if (!existingTransaction) {
          throw new Error('Transaction is mandatory but no existing transaction found');
        }
        return this.executeInExistingTransaction(existingTransaction, target, args, originalMethod, metadata);
      
      case 'NEVER':
        if (existingTransaction) {
          throw new Error('Transaction is not allowed but existing transaction found');
        }
        return originalMethod.apply(target, args);
      
      default:
        return existingTransaction 
          ? this.executeInExistingTransaction(existingTransaction, target, args, originalMethod, metadata)
          : this.executeInNewTransaction(target, args, originalMethod, metadata, context);
    }
  }
  
  private async executeInNewTransaction<T>(
    target: any,
    args: any[],
    originalMethod: Function,
    metadata: TransactionMetadata,
    context?: Context
  ): Promise<T> {
    // Start new transaction
    const transactionContext = await this.begin(metadata);
    
    if (context) {
      this.setRequestTransaction(context, transactionContext);
    }
    
    try {
      const result = await originalMethod.apply(target, args);
      
      if (transactionContext.rollbackOnly) {
        await this.rollback(transactionContext);
        throw new Error('Transaction marked for rollback');
      }
      
      await this.commit(transactionContext);
      return result;
    } catch (error) {
      await this.rollback(transactionContext);
      throw error;
    } finally {
      if (context) {
        this.clearRequestTransaction(context);
      }
      this.removeTransactionContext(transactionContext);
    }
  }
  
  private async executeInExistingTransaction<T>(
    existingTransaction: TransactionContext,
    target: any,
    args: any[],
    originalMethod: Function,
    metadata: TransactionMetadata
  ): Promise<T> {
    // Use existing transaction (nested transaction support with savepoints)
    return this.handleNestedTransaction(existingTransaction, target, args, originalMethod);
  }
  
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
}

/**
 * In-memory transaction manager for testing
 */
export class InMemoryTransactionManager extends BaseTransactionManager {
  private transactions = new Map<string, any>();
  public currentTransactionId: string | null = null; // For testing purposes
  
  async begin(options?: TransactionMetadata): Promise<TransactionContext> {
    const context = this.createTransactionContext(options);
    
    // Simulate transaction begin
    this.transactions.set(context.id, {
      operations: [],
      committed: false,
      rolledBack: false
    });
    
    // Set current transaction for testing
    this.currentTransactionId = context.id;
    
    return context;
  }
  
  async commit(context: TransactionContext): Promise<void> {
    const transaction = this.transactions.get(context.id);
    if (!transaction) {
      throw new Error(`Transaction ${context.id} not found`);
    }
    
    if (transaction.rolledBack) {
      throw new Error(`Transaction ${context.id} already rolled back`);
    }
    
    transaction.committed = true;
    
    // Notify mock database to commit transaction data
    if (typeof (globalThis as any).mockDatabase?.commitTransaction === 'function') {
      (globalThis as any).mockDatabase.commitTransaction(context.id);
    }
    
    this.transactions.delete(context.id);
    this.removeTransactionContext(context);
    
    // Clear current transaction
    if (this.currentTransactionId === context.id) {
      this.currentTransactionId = null;
    }
  }
  
  async rollback(context: TransactionContext): Promise<void> {
    const transaction = this.transactions.get(context.id);
    if (!transaction) {
      throw new Error(`Transaction ${context.id} not found`);
    }
    
    transaction.rolledBack = true;
    
    // Notify mock database to rollback transaction data
    if (typeof (globalThis as any).mockDatabase?.rollbackTransaction === 'function') {
      (globalThis as any).mockDatabase.rollbackTransaction(context.id);
    }
    
    this.transactions.delete(context.id);
    this.removeTransactionContext(context);
    
    // Clear current transaction
    if (this.currentTransactionId === context.id) {
      this.currentTransactionId = null;
    }
  }
  
  async savepoint(context: TransactionContext, name: string): Promise<void> {
    context.savepoints.push(name);
    
    const transaction = this.transactions.get(context.id);
    if (transaction) {
      transaction.savepoints = transaction.savepoints || [];
      transaction.savepoints.push(name);
    }
  }
  
  async rollbackToSavepoint(context: TransactionContext, name: string): Promise<void> {
    const index = context.savepoints.indexOf(name);
    if (index === -1) {
      throw new Error(`Savepoint ${name} not found`);
    }
    
    // Remove savepoints after the target savepoint
    context.savepoints = context.savepoints.slice(0, index + 1);
    
    const transaction = this.transactions.get(context.id);
    if (transaction && transaction.savepoints) {
      transaction.savepoints = transaction.savepoints.slice(0, index + 1);
    }
  }
}

// Global transaction manager instance
let globalTransactionManager: ITransactionManager | null = null;

export function setGlobalTransactionManager(manager: ITransactionManager): void {
  globalTransactionManager = manager;
}

export function getGlobalTransactionManager(): ITransactionManager {
  if (!globalTransactionManager) {
    globalTransactionManager = new InMemoryTransactionManager();
  }
  return globalTransactionManager;
}