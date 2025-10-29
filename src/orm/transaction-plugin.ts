import { Plugin } from '../core/plugin';
import { VeloceTS } from '../core/application';
import { transactionMiddleware } from './transaction-interceptor';
import { globalTransactionEventManager, TransactionLoggingListener, TransactionMetricsListener } from './transaction-events';
import { setGlobalTransactionManager, getGlobalTransactionManager, InMemoryTransactionManager } from './transaction-manager';

/**
 * Transaction plugin configuration
 */
export interface TransactionPluginConfig {
  enableLogging?: boolean;
  enableMetrics?: boolean;
  defaultIsolation?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  defaultTimeout?: number;
  customTransactionManager?: any;
}

/**
 * Transaction management plugin for FastAPI-TS
 */
export class TransactionPlugin implements Plugin {
  name = 'transaction';
  version = '1.0.0';
  
  private config: TransactionPluginConfig;
  private metricsListener?: TransactionMetricsListener;
  
  constructor(config?: TransactionPluginConfig) {
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      defaultIsolation: 'READ_COMMITTED',
      defaultTimeout: 30000,
      ...config
    };
  }
  
  async install(app: VeloceTS): Promise<void> {
    // Set up transaction manager
    this.setupTransactionManager();
    
    // Add transaction middleware
    app.use(transactionMiddleware());
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Register transaction utilities in DI container
    this.registerTransactionUtilities(app);
    
    console.log('✅ Transaction plugin installed successfully');
  }
  
  /**
   * Set up transaction manager
   */
  private setupTransactionManager(): void {
    if (this.config.customTransactionManager) {
      setGlobalTransactionManager(this.config.customTransactionManager);
    } else {
      // Use in-memory transaction manager as default
      setGlobalTransactionManager(new InMemoryTransactionManager());
    }
  }
  
  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    if (this.config.enableLogging) {
      const loggingListener = new TransactionLoggingListener();
      globalTransactionEventManager.addListener(loggingListener);
    }
    
    if (this.config.enableMetrics) {
      this.metricsListener = new TransactionMetricsListener();
      globalTransactionEventManager.addListener(this.metricsListener);
    }
  }
  
  /**
   * Register transaction utilities in DI container
   */
  private registerTransactionUtilities(app: VeloceTS): void {
    const container = app.getContainer();
    
    // Create token classes for DI registration
    class TransactionEventManagerToken {}
    class TransactionMetricsToken {}
    class TransactionUtilsToken {}
    
    // Register transaction event manager
    container.register(TransactionEventManagerToken, {
      scope: 'singleton',
      factory: () => globalTransactionEventManager
    });
    
    // Register transaction metrics
    if (this.metricsListener) {
      container.register(TransactionMetricsToken, {
        scope: 'singleton',
        factory: () => ({
          getMetrics: () => this.metricsListener!.getMetrics(),
          resetMetrics: () => this.metricsListener!.resetMetrics()
        })
      });
    }
    
    // Register transaction utilities
    container.register(TransactionUtilsToken, {
      scope: 'singleton',
      factory: () => ({
        executeInTransaction: async <T>(callback: () => Promise<T>) => {
          const transactionManager = getGlobalTransactionManager();
          const context = await transactionManager.begin();
          
          try {
            const result = await callback();
            
            if (context.rollbackOnly) {
              await transactionManager.rollback(context);
              throw new Error('Transaction marked for rollback');
            }
            
            await transactionManager.commit(context);
            return result;
          } catch (error) {
            await transactionManager.rollback(context);
            throw error;
          }
        },
        getCurrentTransaction: () => {
          // This would need to be implemented based on the current context
          return null;
        },
        isInTransaction: () => {
          // This would need to be implemented based on the current context
          return false;
        }
      })
    });
  }
  
  /**
   * Get transaction metrics
   */
  getMetrics() {
    return this.metricsListener?.getMetrics();
  }
  
  /**
   * Reset transaction metrics
   */
  resetMetrics(): void {
    this.metricsListener?.resetMetrics();
  }
  
  /**
   * Add custom event listener
   */
  addEventListener(listener: any): void {
    globalTransactionEventManager.addListener(listener);
  }
  
  /**
   * Remove event listener
   */
  removeEventListener(listener: any): void {
    globalTransactionEventManager.removeListener(listener);
  }
}

/**
 * Helper function to create transaction plugin
 */
export function createTransactionPlugin(config?: TransactionPluginConfig): TransactionPlugin {
  return new TransactionPlugin(config);
}

/**
 * Transaction service for manual transaction management
 */
export class TransactionService {
  constructor(private transactionManager: any) {}
  
  /**
   * Execute callback in transaction
   */
  async executeInTransaction<T>(callback: () => Promise<T>): Promise<T> {
    const context = await this.transactionManager.begin();
    
    try {
      const result = await callback();
      
      if (context.rollbackOnly) {
        await this.transactionManager.rollback(context);
        throw new Error('Transaction marked for rollback');
      }
      
      await this.transactionManager.commit(context);
      return result;
    } catch (error) {
      await this.transactionManager.rollback(context);
      throw error;
    }
  }
  
  /**
   * Create savepoint
   */
  async createSavepoint(name: string): Promise<void> {
    // This would need access to the current transaction context
    // Implementation depends on how context is managed
  }
  
  /**
   * Rollback to savepoint
   */
  async rollbackToSavepoint(name: string): Promise<void> {
    // This would need access to the current transaction context
    // Implementation depends on how context is managed
  }
  
  /**
   * Mark current transaction for rollback only
   */
  setRollbackOnly(): void {
    // This would need access to the current transaction context
    // Implementation depends on how context is managed
  }
  
  /**
   * Check if currently in transaction
   */
  isInTransaction(): boolean {
    // This would need access to the current transaction context
    // Implementation depends on how context is managed
    return false;
  }
}

/**
 * Transaction template for programmatic transaction management
 */
export class TransactionTemplate {
  constructor(
    private transactionManager: any,
    private defaultOptions?: {
      isolation?: string;
      timeout?: number;
      readOnly?: boolean;
    }
  ) {}
  
  /**
   * Execute callback with transaction template
   */
  async execute<T>(
    callback: () => Promise<T>,
    options?: {
      isolation?: string;
      timeout?: number;
      readOnly?: boolean;
    }
  ): Promise<T> {
    const transactionOptions = { ...this.defaultOptions, ...options };
    const context = await this.transactionManager.begin(transactionOptions);
    
    try {
      const result = await callback();
      
      if (context.rollbackOnly) {
        await this.transactionManager.rollback(context);
        throw new Error('Transaction marked for rollback');
      }
      
      await this.transactionManager.commit(context);
      return result;
    } catch (error) {
      await this.transactionManager.rollback(context);
      throw error;
    }
  }
  
  /**
   * Execute callback with read-only transaction
   */
  async executeReadOnly<T>(callback: () => Promise<T>): Promise<T> {
    return this.execute(callback, { readOnly: true });
  }
  
  /**
   * Execute callback with specific isolation level
   */
  async executeWithIsolation<T>(
    callback: () => Promise<T>,
    isolation: string
  ): Promise<T> {
    return this.execute(callback, { isolation });
  }
}