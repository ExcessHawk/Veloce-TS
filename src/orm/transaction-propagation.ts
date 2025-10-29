import { TransactionContext, TransactionMetadata } from './transaction-manager';

// Transaction propagation types
export enum TransactionPropagation {
  REQUIRED = 'REQUIRED',           // Join existing transaction or create new one
  REQUIRES_NEW = 'REQUIRES_NEW',   // Always create new transaction
  SUPPORTS = 'SUPPORTS',           // Join existing transaction if available, otherwise execute without transaction
  NOT_SUPPORTED = 'NOT_SUPPORTED', // Execute without transaction, suspend existing if present
  MANDATORY = 'MANDATORY',         // Must have existing transaction, throw error if none
  NEVER = 'NEVER'                  // Must not have transaction, throw error if present
}

// Enhanced transaction metadata with propagation
export interface EnhancedTransactionMetadata extends TransactionMetadata {
  propagation?: TransactionPropagation;
  rollbackFor?: (new (...args: any[]) => Error)[];
  noRollbackFor?: (new (...args: any[]) => Error)[];
}

/**
 * Transaction propagation manager
 */
export class TransactionPropagationManager {
  /**
   * Determine if a new transaction should be started based on propagation
   */
  shouldStartNewTransaction(
    propagation: TransactionPropagation,
    existingTransaction?: TransactionContext
  ): boolean {
    switch (propagation) {
      case TransactionPropagation.REQUIRED:
        return !existingTransaction;
      
      case TransactionPropagation.REQUIRES_NEW:
        return true;
      
      case TransactionPropagation.SUPPORTS:
        return false;
      
      case TransactionPropagation.NOT_SUPPORTED:
        return false;
      
      case TransactionPropagation.MANDATORY:
        if (!existingTransaction) {
          throw new Error('Transaction is mandatory but no existing transaction found');
        }
        return false;
      
      case TransactionPropagation.NEVER:
        if (existingTransaction) {
          throw new Error('Transaction is not allowed but existing transaction found');
        }
        return false;
      
      default:
        return !existingTransaction;
    }
  }
  
  /**
   * Determine if existing transaction should be suspended
   */
  shouldSuspendTransaction(
    propagation: TransactionPropagation,
    existingTransaction?: TransactionContext
  ): boolean {
    return propagation === TransactionPropagation.NOT_SUPPORTED && !!existingTransaction;
  }
  
  /**
   * Determine if method should execute within transaction
   */
  shouldExecuteInTransaction(
    propagation: TransactionPropagation,
    existingTransaction?: TransactionContext
  ): boolean {
    switch (propagation) {
      case TransactionPropagation.REQUIRED:
      case TransactionPropagation.REQUIRES_NEW:
      case TransactionPropagation.MANDATORY:
        return true;
      
      case TransactionPropagation.SUPPORTS:
        return !!existingTransaction;
      
      case TransactionPropagation.NOT_SUPPORTED:
      case TransactionPropagation.NEVER:
        return false;
      
      default:
        return true;
    }
  }
  
  /**
   * Determine if error should cause rollback
   */
  shouldRollbackForError(
    error: Error,
    metadata: EnhancedTransactionMetadata
  ): boolean {
    // Check noRollbackFor first
    if (metadata.noRollbackFor) {
      for (const errorType of metadata.noRollbackFor) {
        if (error instanceof errorType) {
          return false;
        }
      }
    }
    
    // Check rollbackFor
    if (metadata.rollbackFor) {
      for (const errorType of metadata.rollbackFor) {
        if (error instanceof errorType) {
          return true;
        }
      }
      // If rollbackFor is specified but error doesn't match, don't rollback
      return false;
    }
    
    // Default: rollback for all errors
    return true;
  }
}

/**
 * Enhanced @Transactional decorator with propagation support
 */
export function TransactionalWithPropagation(options?: EnhancedTransactionMetadata): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const metadata: EnhancedTransactionMetadata = {
      isolation: options?.isolation || 'READ_COMMITTED',
      timeout: options?.timeout || 30000,
      readOnly: options?.readOnly || false,
      propagation: options?.propagation || TransactionPropagation.REQUIRED,
      rollbackFor: options?.rollbackFor,
      noRollbackFor: options?.noRollbackFor
    };
    
    Reflect.defineMetadata('transactional', metadata, target, propertyKey);
    
    descriptor.value = async function (...args: any[]) {
      // Import here to avoid circular dependencies
      const { getGlobalTransactionManager } = await import('./transaction-manager');
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
 * Specific propagation decorators for convenience
 */
export function Required(options?: Omit<EnhancedTransactionMetadata, 'propagation'>): MethodDecorator {
  return TransactionalWithPropagation({ ...options, propagation: TransactionPropagation.REQUIRED });
}

export function RequiresNew(options?: Omit<EnhancedTransactionMetadata, 'propagation'>): MethodDecorator {
  return TransactionalWithPropagation({ ...options, propagation: TransactionPropagation.REQUIRES_NEW });
}

export function Supports(options?: Omit<EnhancedTransactionMetadata, 'propagation'>): MethodDecorator {
  return TransactionalWithPropagation({ ...options, propagation: TransactionPropagation.SUPPORTS });
}

export function NotSupported(options?: Omit<EnhancedTransactionMetadata, 'propagation'>): MethodDecorator {
  return TransactionalWithPropagation({ ...options, propagation: TransactionPropagation.NOT_SUPPORTED });
}

export function Mandatory(options?: Omit<EnhancedTransactionMetadata, 'propagation'>): MethodDecorator {
  return TransactionalWithPropagation({ ...options, propagation: TransactionPropagation.MANDATORY });
}

export function Never(options?: Omit<EnhancedTransactionMetadata, 'propagation'>): MethodDecorator {
  return TransactionalWithPropagation({ ...options, propagation: TransactionPropagation.NEVER });
}