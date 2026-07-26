/**
 * Transaction manager + transaction event tests.
 *
 * Uses InMemoryTransactionManager (src/orm/transaction-manager.ts) — the same
 * begin/commit/rollback/savepoint contract real adapters (Drizzle/Prisma/TypeORM)
 * implement — to exercise propagation semantics and rollback behavior without a
 * real database, plus TransactionEventManager's listener dispatch.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import {
  InMemoryTransactionManager,
  type TransactionMetadata,
} from '../src/orm/transaction-manager';
import {
  TransactionEventManager,
  TransactionEventType,
  TransactionMetricsListener,
  type TransactionEvent,
  type TransactionEventListener,
} from '../src/orm/transaction-events';

describe('InMemoryTransactionManager — begin/commit/rollback', () => {
  let manager: InMemoryTransactionManager;

  beforeEach(() => {
    manager = new InMemoryTransactionManager();
  });

  it('begin() creates an active transaction context', async () => {
    const ctx = await manager.begin();
    expect(ctx.id).toBeTruthy();
    expect(manager.isActive(ctx)).toBe(true);
    expect(manager.currentTransactionId).toBe(ctx.id);
  });

  it('commit() deactivates the transaction and clears currentTransactionId', async () => {
    const ctx = await manager.begin();
    await manager.commit(ctx);
    expect(manager.isActive(ctx)).toBe(false);
    expect(manager.currentTransactionId).toBeNull();
  });

  it('commit() on an already-rolled-back transaction throws', async () => {
    const ctx = await manager.begin();
    await manager.rollback(ctx);
    await expect(manager.commit(ctx)).rejects.toThrow(/not found/);
  });

  it('rollback() deactivates the transaction', async () => {
    const ctx = await manager.begin();
    await manager.rollback(ctx);
    expect(manager.isActive(ctx)).toBe(false);
  });

  it('setRollbackOnly() flags the context', async () => {
    const ctx = await manager.begin();
    expect(ctx.rollbackOnly).toBe(false);
    manager.setRollbackOnly(ctx);
    expect(ctx.rollbackOnly).toBe(true);
  });

  it('savepoint() then rollbackToSavepoint() truncates savepoints after the target', async () => {
    const ctx = await manager.begin();
    await manager.savepoint(ctx, 'sp1');
    await manager.savepoint(ctx, 'sp2');
    expect(ctx.savepoints).toEqual(['sp1', 'sp2']);

    await manager.rollbackToSavepoint(ctx, 'sp1');
    expect(ctx.savepoints).toEqual(['sp1']);
  });

  it('rollbackToSavepoint() throws for an unknown savepoint name', async () => {
    const ctx = await manager.begin();
    await manager.savepoint(ctx, 'sp1');
    await expect(manager.rollbackToSavepoint(ctx, 'nope')).rejects.toThrow(/not found/);
  });
});

describe('handleTransactional() — propagation levels', () => {
  let manager: InMemoryTransactionManager;

  beforeEach(() => {
    manager = new InMemoryTransactionManager();
  });

  /** Registers @Transactional metadata the same way the real decorator does. */
  function withMetadata(metadata: TransactionMetadata) {
    const target = {};
    Reflect.defineMetadata('transactional', metadata, target, 'run');
    return target;
  }

  it('REQUIRED starts a new transaction when none exists and commits on success', async () => {
    const target = withMetadata({ propagation: 'REQUIRED' });
    let sawActiveDuringCall = false;

    const result = await manager.handleTransactional(
      target,
      'run',
      [],
      async () => {
        sawActiveDuringCall = manager.currentTransactionId !== null;
        return 'ok';
      }
    );

    expect(result).toBe('ok');
    expect(sawActiveDuringCall).toBe(true);
    expect(manager.currentTransactionId).toBeNull(); // committed + cleared
  });

  it('REQUIRED joins an existing transaction via savepoint instead of starting a new one', async () => {
    const target = withMetadata({ propagation: 'REQUIRED' });
    const outerCtx = await manager.begin();
    const fakeContext: any = { __marker: 'ctx' };
    manager.setRequestTransaction(fakeContext, outerCtx);

    let savepointsAtCallTime: string[] = [];
    await manager.handleTransactional(target, 'run', [], async () => {
      savepointsAtCallTime = [...outerCtx.savepoints];
      return 'nested-ok';
    }, fakeContext);

    // A savepoint was created for the nested call, proving it joined outerCtx
    // rather than starting an independent transaction.
    expect(savepointsAtCallTime.length).toBe(1);
    expect(manager.isActive(outerCtx)).toBe(true); // outer transaction untouched

    await manager.commit(outerCtx);
  });

  it('REQUIRES_NEW always starts a fresh transaction even when one exists', async () => {
    const target = withMetadata({ propagation: 'REQUIRES_NEW' });
    const outerCtx = await manager.begin();
    const fakeContext: any = {};
    manager.setRequestTransaction(fakeContext, outerCtx);

    let innerTransactionId: string | null = null;
    await manager.handleTransactional(target, 'run', [], async () => {
      innerTransactionId = manager.currentTransactionId;
      return 'inner-ok';
    }, fakeContext);

    // The inner call ran under its own (now-committed) transaction, distinct
    // from the still-active outer one.
    expect(innerTransactionId).not.toBe(outerCtx.id);
    expect(manager.isActive(outerCtx)).toBe(true);

    await manager.commit(outerCtx);
  });

  it('SUPPORTS runs without a transaction when none exists', async () => {
    const target = withMetadata({ propagation: 'SUPPORTS' });
    let sawActiveDuringCall = true;

    await manager.handleTransactional(target, 'run', [], async () => {
      sawActiveDuringCall = manager.currentTransactionId !== null;
      return 'ok';
    });

    expect(sawActiveDuringCall).toBe(false);
  });

  it('NOT_SUPPORTED executes the method directly', async () => {
    const target = withMetadata({ propagation: 'NOT_SUPPORTED' });
    const result = await manager.handleTransactional(target, 'run', [], async () => 'plain');
    expect(result).toBe('plain');
  });

  it('MANDATORY throws when no existing transaction is present', async () => {
    const target = withMetadata({ propagation: 'MANDATORY' });
    await expect(
      manager.handleTransactional(target, 'run', [], async () => 'x')
    ).rejects.toThrow(/mandatory/i);
  });

  it('MANDATORY succeeds when a transaction already exists', async () => {
    const target = withMetadata({ propagation: 'MANDATORY' });
    const outerCtx = await manager.begin();
    const fakeContext: any = {};
    manager.setRequestTransaction(fakeContext, outerCtx);

    const result = await manager.handleTransactional(target, 'run', [], async () => 'joined', fakeContext);
    expect(result).toBe('joined');

    await manager.commit(outerCtx);
  });

  it('NEVER throws when an existing transaction is present', async () => {
    const target = withMetadata({ propagation: 'NEVER' });
    const outerCtx = await manager.begin();
    const fakeContext: any = {};
    manager.setRequestTransaction(fakeContext, outerCtx);

    await expect(
      manager.handleTransactional(target, 'run', [], async () => 'x', fakeContext)
    ).rejects.toThrow(/not allowed/i);

    await manager.commit(outerCtx);
  });

  it('NEVER succeeds when no existing transaction is present', async () => {
    const target = withMetadata({ propagation: 'NEVER' });
    const result = await manager.handleTransactional(target, 'run', [], async () => 'ok');
    expect(result).toBe('ok');
  });

  it('rolls back a new transaction when the wrapped method throws', async () => {
    const target = withMetadata({ propagation: 'REQUIRED' });
    await expect(
      manager.handleTransactional(target, 'run', [], async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // No leaked active transaction after the failure
    expect(manager.currentTransactionId).toBeNull();
  });

  it('rolls back when the method succeeds but marks rollbackOnly', async () => {
    const target = withMetadata({ propagation: 'REQUIRED' });
    const fakeContext: any = {};
    await expect(
      manager.handleTransactional(
        target,
        'run',
        [],
        async () => {
          // executeInNewTransaction registers the ctx via setRequestTransaction
          // before invoking the method, so it's reachable through the public API
          const ctx = manager.getRequestTransaction(fakeContext)!;
          manager.setRollbackOnly(ctx);
          return 'would-be-ok';
        },
        fakeContext
      )
    ).rejects.toThrow(/marked for rollback/);
  });

  it('methods without @Transactional metadata run unwrapped', async () => {
    const target = {}; // no Reflect metadata defined
    const result = await manager.handleTransactional(target, 'run', ['a', 'b'], async (a: string, b: string) => `${a}-${b}`);
    expect(result).toBe('a-b');
  });
});

describe('TransactionEventManager', () => {
  let manager: InMemoryTransactionManager;
  let events: TransactionEventManager;

  beforeEach(() => {
    manager = new InMemoryTransactionManager();
    events = new TransactionEventManager();
  });

  it('dispatches events to general listeners in order', async () => {
    const seen: TransactionEventType[] = [];
    const listener: TransactionEventListener = {
      onTransactionEvent: (event) => {
        seen.push(event.type);
      },
    };
    events.addListener(listener);

    const ctx = await manager.begin();
    await events.emitEvent({ type: TransactionEventType.AFTER_BEGIN, context: ctx, timestamp: new Date() });
    await events.emitEvent({ type: TransactionEventType.AFTER_COMMIT, context: ctx, timestamp: new Date() });

    expect(seen).toEqual([TransactionEventType.AFTER_BEGIN, TransactionEventType.AFTER_COMMIT]);
  });

  it('dispatches to specific commit/rollback listeners', async () => {
    const calls: string[] = [];
    events.addCommitListener({
      onBeforeCommit: () => { calls.push('before-commit'); },
      onAfterCommit: () => { calls.push('after-commit'); },
    });
    events.addRollbackListener({
      onAfterRollback: (_ctx, error) => { calls.push(`after-rollback:${error?.message}`); },
    });

    const ctx = await manager.begin();
    await events.emitEvent({ type: TransactionEventType.BEFORE_COMMIT, context: ctx, timestamp: new Date() });
    await events.emitEvent({ type: TransactionEventType.AFTER_COMMIT, context: ctx, timestamp: new Date() });
    await events.emitEvent({
      type: TransactionEventType.AFTER_ROLLBACK,
      context: ctx,
      timestamp: new Date(),
      error: new Error('boom'),
    });

    expect(calls).toEqual(['before-commit', 'after-commit', 'after-rollback:boom']);
  });

  it('a throwing listener does not prevent other listeners from running', async () => {
    const calls: string[] = [];
    events.addListener({
      onTransactionEvent: () => { throw new Error('listener A failed'); },
    });
    events.addListener({
      onTransactionEvent: () => { calls.push('listener B ran'); },
    });

    const ctx = await manager.begin();
    // Errors are caught per-listener inside emitEvent — must not throw here
    await events.emitEvent({ type: TransactionEventType.AFTER_BEGIN, context: ctx, timestamp: new Date() });

    expect(calls).toEqual(['listener B ran']);
  });

  it('removeListener() stops further dispatch to that listener', async () => {
    const calls: string[] = [];
    const listener: TransactionEventListener = {
      onTransactionEvent: () => { calls.push('called'); },
    };
    events.addListener(listener);
    events.removeListener(listener);

    const ctx = await manager.begin();
    await events.emitEvent({ type: TransactionEventType.AFTER_BEGIN, context: ctx, timestamp: new Date() });

    expect(calls).toEqual([]);
  });

  it('TransactionMetricsListener tracks committed and rolled-back counts', async () => {
    const metrics = new TransactionMetricsListener();
    events.addListener(metrics);

    const ctx1 = await manager.begin();
    await events.emitEvent({ type: TransactionEventType.AFTER_BEGIN, context: ctx1, timestamp: new Date() });
    await events.emitEvent({ type: TransactionEventType.AFTER_COMMIT, context: ctx1, timestamp: new Date() });

    const ctx2 = await manager.begin();
    await events.emitEvent({ type: TransactionEventType.AFTER_BEGIN, context: ctx2, timestamp: new Date() });
    await events.emitEvent({ type: TransactionEventType.AFTER_ROLLBACK, context: ctx2, timestamp: new Date() });

    const snapshot = metrics.getMetrics();
    expect(snapshot.totalTransactions).toBe(2);
    expect(snapshot.committedTransactions).toBe(1);
    expect(snapshot.rolledBackTransactions).toBe(1);

    metrics.resetMetrics();
    expect(metrics.getMetrics().totalTransactions).toBe(0);
  });

  it('clearAllListeners() removes every registered listener', async () => {
    const calls: string[] = [];
    events.addListener({ onTransactionEvent: () => { calls.push('x'); } });
    events.addCommitListener({ onAfterCommit: () => { calls.push('y'); } });
    events.clearAllListeners();

    const ctx = await manager.begin();
    await events.emitEvent({ type: TransactionEventType.AFTER_COMMIT, context: ctx, timestamp: new Date() });

    expect(calls).toEqual([]);
  });
});
