import { Context } from 'hono';
import { getGlobalTransactionManager, TransactionMetadata } from './transaction-manager';

/**
 * Transaction interceptor for automatic transaction handling
 */
export class TransactionInterceptor {
  private static instance: TransactionInterceptor;
  
  private constructor() {}
  
  static getInstance(): TransactionInterceptor {
    if (!TransactionInterceptor.instance) {
      TransactionInterceptor.instance = new TransactionInterceptor();
    }
    return TransactionInterceptor.instance;
  }
  
  /**
   * Intercept method calls and handle transactions
   */
  async intercept(
    target: any,
    propertyKey: string,
    args: any[],
    originalMethod: Function,
    context?: Context
  ): Promise<any> {
    const transactionManager = getGlobalTransactionManager();
    
    // Check if method has @Transactional decorator
    const metadata = Reflect.getMetadata('transactional', target, propertyKey) as TransactionMetadata;
    
    if (metadata) {
      return await transactionManager.handleTransactional(
        target,
        propertyKey,
        args,
        originalMethod,
        context
      );
    }
    
    // No transaction needed, execute normally
    return await originalMethod.apply(target, args);
  }
  
  /**
   * Create a transactional proxy for an object
   */
  createTransactionalProxy<T extends object>(target: T, context?: Context): T {
    return new Proxy(target, {
      get: (obj, prop) => {
        const value = obj[prop as keyof T];
        
        if (typeof value === 'function') {
          return async (...args: any[]) => {
            return await this.intercept(
              obj,
              prop as string,
              args,
              value.bind(obj),
              context
            );
          };
        }
        
        return value;
      }
    });
  }
}

/**
 * Transaction middleware for Hono
 */
export function transactionMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    const interceptor = TransactionInterceptor.getInstance();
    
    // Store the interceptor in the context for use in handlers
    c.set('transactionInterceptor', interceptor);
    c.set('transactionContext', c);
    
    await next();
  };
}

/**
 * Get transaction interceptor from context
 */
export function getTransactionInterceptor(c: Context): TransactionInterceptor {
  return c.get('transactionInterceptor') || TransactionInterceptor.getInstance();
}

/**
 * Create transactional proxy from context
 */
export function createTransactionalProxy<T extends object>(c: Context, target: T): T {
  const interceptor = getTransactionInterceptor(c);
  return interceptor.createTransactionalProxy(target, c);
}