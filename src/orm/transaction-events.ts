import { TransactionContext } from './transaction-manager';

// Transaction event types
export enum TransactionEventType {
  BEFORE_BEGIN = 'BEFORE_BEGIN',
  AFTER_BEGIN = 'AFTER_BEGIN',
  BEFORE_COMMIT = 'BEFORE_COMMIT',
  AFTER_COMMIT = 'AFTER_COMMIT',
  BEFORE_ROLLBACK = 'BEFORE_ROLLBACK',
  AFTER_ROLLBACK = 'AFTER_ROLLBACK',
  BEFORE_SAVEPOINT = 'BEFORE_SAVEPOINT',
  AFTER_SAVEPOINT = 'AFTER_SAVEPOINT',
  BEFORE_ROLLBACK_TO_SAVEPOINT = 'BEFORE_ROLLBACK_TO_SAVEPOINT',
  AFTER_ROLLBACK_TO_SAVEPOINT = 'AFTER_ROLLBACK_TO_SAVEPOINT'
}

// Transaction event interface
export interface TransactionEvent {
  type: TransactionEventType;
  context: TransactionContext;
  timestamp: Date;
  metadata?: any;
  error?: Error;
}

// Transaction event listener interface
export interface TransactionEventListener {
  onTransactionEvent(event: TransactionEvent): Promise<void> | void;
}

// Specific event listener interfaces
export interface TransactionBeginListener {
  onBeforeBegin?(context: TransactionContext): Promise<void> | void;
  onAfterBegin?(context: TransactionContext): Promise<void> | void;
}

export interface TransactionCommitListener {
  onBeforeCommit?(context: TransactionContext): Promise<void> | void;
  onAfterCommit?(context: TransactionContext): Promise<void> | void;
}

export interface TransactionRollbackListener {
  onBeforeRollback?(context: TransactionContext, error?: Error): Promise<void> | void;
  onAfterRollback?(context: TransactionContext, error?: Error): Promise<void> | void;
}

export interface TransactionSavepointListener {
  onBeforeSavepoint?(context: TransactionContext, name: string): Promise<void> | void;
  onAfterSavepoint?(context: TransactionContext, name: string): Promise<void> | void;
  onBeforeRollbackToSavepoint?(context: TransactionContext, name: string): Promise<void> | void;
  onAfterRollbackToSavepoint?(context: TransactionContext, name: string): Promise<void> | void;
}

/**
 * Transaction event manager
 */
export class TransactionEventManager {
  private listeners: TransactionEventListener[] = [];
  private beginListeners: TransactionBeginListener[] = [];
  private commitListeners: TransactionCommitListener[] = [];
  private rollbackListeners: TransactionRollbackListener[] = [];
  private savepointListeners: TransactionSavepointListener[] = [];

  /**
   * Add a general transaction event listener
   */
  addListener(listener: TransactionEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a general transaction event listener
   */
  removeListener(listener: TransactionEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Add a transaction begin listener
   */
  addBeginListener(listener: TransactionBeginListener): void {
    this.beginListeners.push(listener);
  }

  /**
   * Add a transaction commit listener
   */
  addCommitListener(listener: TransactionCommitListener): void {
    this.commitListeners.push(listener);
  }

  /**
   * Add a transaction rollback listener
   */
  addRollbackListener(listener: TransactionRollbackListener): void {
    this.rollbackListeners.push(listener);
  }

  /**
   * Add a transaction savepoint listener
   */
  addSavepointListener(listener: TransactionSavepointListener): void {
    this.savepointListeners.push(listener);
  }

  /**
   * Emit a transaction event
   */
  async emitEvent(event: TransactionEvent): Promise<void> {
    // Emit to general listeners
    for (const listener of this.listeners) {
      try {
        await listener.onTransactionEvent(event);
      } catch (error) {
        console.error('Error in transaction event listener:', error);
      }
    }

    // Emit to specific listeners
    await this.emitSpecificEvent(event);
  }

  /**
   * Emit event to specific listeners
   */
  private async emitSpecificEvent(event: TransactionEvent): Promise<void> {
    switch (event.type) {
      case TransactionEventType.BEFORE_BEGIN:
        for (const listener of this.beginListeners) {
          if (listener.onBeforeBegin) {
            try {
              await listener.onBeforeBegin(event.context);
            } catch (error) {
              console.error('Error in before begin listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.AFTER_BEGIN:
        for (const listener of this.beginListeners) {
          if (listener.onAfterBegin) {
            try {
              await listener.onAfterBegin(event.context);
            } catch (error) {
              console.error('Error in after begin listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.BEFORE_COMMIT:
        for (const listener of this.commitListeners) {
          if (listener.onBeforeCommit) {
            try {
              await listener.onBeforeCommit(event.context);
            } catch (error) {
              console.error('Error in before commit listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.AFTER_COMMIT:
        for (const listener of this.commitListeners) {
          if (listener.onAfterCommit) {
            try {
              await listener.onAfterCommit(event.context);
            } catch (error) {
              console.error('Error in after commit listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.BEFORE_ROLLBACK:
        for (const listener of this.rollbackListeners) {
          if (listener.onBeforeRollback) {
            try {
              await listener.onBeforeRollback(event.context, event.error);
            } catch (error) {
              console.error('Error in before rollback listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.AFTER_ROLLBACK:
        for (const listener of this.rollbackListeners) {
          if (listener.onAfterRollback) {
            try {
              await listener.onAfterRollback(event.context, event.error);
            } catch (error) {
              console.error('Error in after rollback listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.BEFORE_SAVEPOINT:
        for (const listener of this.savepointListeners) {
          if (listener.onBeforeSavepoint) {
            try {
              await listener.onBeforeSavepoint(event.context, event.metadata?.name);
            } catch (error) {
              console.error('Error in before savepoint listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.AFTER_SAVEPOINT:
        for (const listener of this.savepointListeners) {
          if (listener.onAfterSavepoint) {
            try {
              await listener.onAfterSavepoint(event.context, event.metadata?.name);
            } catch (error) {
              console.error('Error in after savepoint listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.BEFORE_ROLLBACK_TO_SAVEPOINT:
        for (const listener of this.savepointListeners) {
          if (listener.onBeforeRollbackToSavepoint) {
            try {
              await listener.onBeforeRollbackToSavepoint(event.context, event.metadata?.name);
            } catch (error) {
              console.error('Error in before rollback to savepoint listener:', error);
            }
          }
        }
        break;

      case TransactionEventType.AFTER_ROLLBACK_TO_SAVEPOINT:
        for (const listener of this.savepointListeners) {
          if (listener.onAfterRollbackToSavepoint) {
            try {
              await listener.onAfterRollbackToSavepoint(event.context, event.metadata?.name);
            } catch (error) {
              console.error('Error in after rollback to savepoint listener:', error);
            }
          }
        }
        break;
    }
  }

  /**
   * Clear all listeners
   */
  clearAllListeners(): void {
    this.listeners = [];
    this.beginListeners = [];
    this.commitListeners = [];
    this.rollbackListeners = [];
    this.savepointListeners = [];
  }
}

/**
 * Transaction event decorators
 */
export function OnTransactionBegin(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata('transaction-event', 'begin', target, propertyKey);
  };
}

export function OnTransactionCommit(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata('transaction-event', 'commit', target, propertyKey);
  };
}

export function OnTransactionRollback(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata('transaction-event', 'rollback', target, propertyKey);
  };
}

/**
 * Built-in transaction event listeners
 */

/**
 * Transaction logging listener
 */
export class TransactionLoggingListener implements TransactionEventListener {
  constructor(private logger: (message: string, data?: any) => void = console.log) { }

  async onTransactionEvent(event: TransactionEvent): Promise<void> {
    const message = `Transaction ${event.type}: ${event.context.id}`;
    const data = {
      timestamp: event.timestamp,
      context: {
        id: event.context.id,
        startTime: event.context.startTime,
        isolation: event.context.isolation,
        timeout: event.context.timeout,
        readOnly: event.context.readOnly,
        savepoints: event.context.savepoints,
        rollbackOnly: event.context.rollbackOnly
      },
      metadata: event.metadata,
      error: event.error?.message
    };

    this.logger(message, data);
  }
}

/**
 * Transaction metrics listener
 */
export class TransactionMetricsListener implements TransactionEventListener {
  private metrics = {
    totalTransactions: 0,
    committedTransactions: 0,
    rolledBackTransactions: 0,
    averageDuration: 0,
    totalDuration: 0
  };

  async onTransactionEvent(event: TransactionEvent): Promise<void> {
    switch (event.type) {
      case TransactionEventType.AFTER_BEGIN:
        this.metrics.totalTransactions++;
        break;

      case TransactionEventType.AFTER_COMMIT:
        this.metrics.committedTransactions++;
        this.updateDuration(event.context);
        break;

      case TransactionEventType.AFTER_ROLLBACK:
        this.metrics.rolledBackTransactions++;
        this.updateDuration(event.context);
        break;
    }
  }

  private updateDuration(context: TransactionContext): void {
    const duration = Date.now() - context.startTime.getTime();
    this.metrics.totalDuration += duration;
    this.metrics.averageDuration = this.metrics.totalDuration /
      (this.metrics.committedTransactions + this.metrics.rolledBackTransactions);
  }

  getMetrics() {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalTransactions: 0,
      committedTransactions: 0,
      rolledBackTransactions: 0,
      averageDuration: 0,
      totalDuration: 0
    };
  }
}

// Global transaction event manager instance
export const globalTransactionEventManager = new TransactionEventManager();