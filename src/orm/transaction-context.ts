/**
 * @module veloce-ts/orm/transaction-context
 * @description Ambient transactions: a database handle that follows the transaction
 * of the current async call chain, plus `runInTransaction`.
 *
 * The problem this solves: a controller or service receives its database once,
 * in its constructor (`@InjectDB() private db`). Opening a transaction gives you
 * a *different* object (`tx`), so every query has to be rewritten to use it and
 * every helper has to accept it as a parameter — and a query that keeps using
 * `this.db` silently runs outside the transaction.
 *
 * Here the injected handle is a thin proxy. Outside a transaction it forwards to
 * the real database; inside one it forwards to the active transaction, found
 * through `AsyncLocalStorage`. Code written against `this.db` becomes
 * transactional by being *called* inside `runInTransaction`, without changing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from '../types/index.js';

/** Anything with a Drizzle-style `transaction(callback)` method. */
export interface TransactionCapable {
  transaction<T>(callback: (tx: any) => Promise<T>, config?: any): Promise<T>;
}

interface ActiveTransaction {
  /** The real (unproxied) database this transaction belongs to. */
  root: object;
  /** The transaction handle queries are forwarded to. */
  tx: any;
  /**
   * False once the transaction has been committed or rolled back. Work that
   * outlives it — a promise nobody awaited — still inherits this async context,
   * and must fall back to the real database instead of a finished transaction.
   */
  active: boolean;
}

export interface RunInTransactionOptions {
  /**
   * What to do when a transaction is already active for this database:
   * - `false` (default): join it. One transaction, one commit.
   * - `true`: open a nested transaction (a savepoint), so a failure inside can
   *   be caught without aborting the outer one.
   */
  nested?: boolean;
  /** Passed through to the driver's `transaction()` (isolation level, access mode…). */
  config?: unknown;
}

/** Hook invoked when an outermost transaction begins. */
export type OnBeginTransaction = (tx: any, c: Context | undefined) => void | Promise<void>;

const ROOT = Symbol.for('veloce-ts:transactional-db:root');
const HOOKS = Symbol.for('veloce-ts:transactional-db:hooks');

const transactions = new AsyncLocalStorage<ActiveTransaction[]>();
const requests = new AsyncLocalStorage<Context>();

function activeFor(root: object): ActiveTransaction | undefined {
  const stack = transactions.getStore();
  if (!stack) return undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.root === root && entry.active) return entry;
  }
  return undefined;
}

/**
 * Wrap a database so it follows the ambient transaction.
 *
 * - No transaction active: every access goes to `db`.
 * - Inside `runInTransaction(db, …)`: every access goes to that transaction.
 * - `db.transaction(cb)` on the wrapper is routed through `runInTransaction`
 *   (as a nested transaction when one is already active), so queries made on
 *   the wrapper inside `cb` are part of it too.
 *
 * Idempotent: wrapping a wrapper returns it unchanged.
 */
export function createTransactionalDb<T extends object>(db: T, hooks: { onBegin?: OnBeginTransaction } = {}): T {
  if (isTransactionalDb(db)) return db;

  const proxy: T = new Proxy(db, {
    get(target, prop) {
      if (prop === ROOT) return target;
      if (prop === HOOKS) return hooks;

      if (prop === 'transaction' && typeof (target as any).transaction === 'function') {
        return (callback: (tx: any) => Promise<unknown>, config?: unknown) =>
          runInTransaction(proxy as any, callback, { nested: true, config });
      }

      const current = activeFor(target)?.tx ?? target;
      const value = Reflect.get(current, prop, current);
      // Query builders rely on `this`; bind to the object the method came from,
      // not to the proxy.
      return typeof value === 'function' ? value.bind(current) : value;
    },
    has(target, prop) {
      return prop === ROOT || prop === HOOKS || Reflect.has(target, prop);
    },
  });

  return proxy;
}

/** Whether `value` is a handle produced by {@link createTransactionalDb}. */
export function isTransactionalDb(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as any)[ROOT] !== undefined;
}

function rootOf(db: object): object {
  return (db as any)[ROOT] ?? db;
}

/**
 * The transaction currently active for `db` in this async call chain, or
 * `undefined`. Rarely needed — queries on the injected handle already use it.
 */
export function getActiveTransaction<TX = any>(db: object): TX | undefined {
  return activeFor(rootOf(db))?.tx;
}

/** Whether a transaction is active for `db` in this async call chain. */
export function isInTransaction(db: object): boolean {
  return activeFor(rootOf(db)) !== undefined;
}

/**
 * Run `fn` inside a transaction of `db`.
 *
 * Commits when `fn` resolves, rolls back when it throws (the error is
 * rethrown). Every query made through the injected handle during `fn` — in
 * this function, in services it calls, anywhere down the awaited call chain —
 * is part of the transaction.
 *
 * Only *awaited* work is covered. A promise started and not awaited may run
 * after the commit; it then uses the plain database, never the finished transaction.
 *
 * @param db - The handle from `@InjectDB()` (or the raw database)
 * @param fn - Receives the transaction handle, for code that prefers it explicit
 *
 * @example
 * ```ts
 * await runInTransaction(this.db, async () => {
 *   await this.db.insert(orders).values(order);
 *   await this.inventory.reserve(order.items);   // uses its own this.db — same transaction
 * });
 * ```
 */
export async function runInTransaction<T>(
  db: TransactionCapable | object,
  fn: (tx: any) => Promise<T> | T,
  options: RunInTransactionOptions = {}
): Promise<T> {
  const root = rootOf(db as object) as TransactionCapable;
  const hooks: { onBegin?: OnBeginTransaction } = (db as any)[HOOKS] ?? {};
  const outer = activeFor(root);

  if (outer && !options.nested) {
    return fn(outer.tx);
  }

  const owner: TransactionCapable = outer ? outer.tx : root;
  if (typeof owner?.transaction !== 'function') {
    throw new TypeError('runInTransaction: the database handle has no transaction() method');
  }

  const stack = transactions.getStore() ?? [];

  return owner.transaction(async (tx: any) => {
    const entry: ActiveTransaction = { root, tx, active: true };
    try {
      return await transactions.run([...stack, entry], async () => {
        // Outermost transaction only: a savepoint inherits what the outer one set up.
        if (!outer && hooks.onBegin) {
          await hooks.onBegin(tx, requests.getStore());
        }
        return fn(tx);
      });
    } finally {
      entry.active = false;
    }
  }, options.config);
}

/** @internal Make the request context available to `onBegin` for transactions started during it. */
export function runWithRequest<T>(c: Context, fn: () => Promise<T>): Promise<T> {
  return requests.run(c, fn);
}

/** @internal Thrown inside a per-request transaction to roll it back after the response was built. */
export class RollbackSignal extends Error {
  constructor() {
    super('Transaction rolled back');
    this.name = 'RollbackSignal';
  }
}
