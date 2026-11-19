/**
 * Ambient transactions: the handle from `@InjectDB()` follows the transaction
 * of the current call chain, so code holding `this.db` becomes transactional
 * by being called inside `runInTransaction` / `@Transactional`.
 *
 * Rollbacks here are real: the database is SQLite (bun:sqlite) and the
 * `transaction()` below issues BEGIN / COMMIT / ROLLBACK / SAVEPOINT against it.
 * Nothing about the outcome is simulated by the test.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { Database } from 'bun:sqlite';
import { VeloceTS } from '../src/core/application';
import { Controller, Get, Post } from '../src/decorators/http';
import { Inject } from '../src/decorators/dependencies';
import { registerDrizzle, InjectDB } from '../src/dependencies/drizzle';
import { Transactional } from '../src/orm/decorators';
import {
  runInTransaction,
  createTransactionalDb,
  isTransactionalDb,
  isInTransaction,
  getActiveTransaction,
} from '../src/orm/transaction-context';
import { BadRequestException } from '../src/errors/exceptions';

/**
 * A database handle with the shape the framework relies on — `transaction(cb)`
 * handing a transaction object to the callback, nestable — over real SQLite.
 * `label` distinguishes the root handle from transaction handles in assertions.
 */
interface Handle {
  label: string;
  insert(name: string): void;
  names(): string[];
  transaction<T>(cb: (tx: Handle) => Promise<T>): Promise<T>;
}

function makeDb(): { db: Handle; sqlite: Database; statements: string[] } {
  const sqlite = new Database(':memory:');
  sqlite.run('CREATE TABLE items (name TEXT NOT NULL)');
  const statements: string[] = [];
  let savepoints = 0;

  const exec = (sql: string) => {
    statements.push(sql);
    sqlite.run(sql);
  };

  const handle = (label: string, depth: number): Handle => ({
    label,
    insert(name: string) {
      sqlite.run('INSERT INTO items (name) VALUES (?)', [name]);
    },
    names() {
      return (sqlite.query('SELECT name FROM items ORDER BY rowid').all() as { name: string }[]).map((r) => r.name);
    },
    async transaction<T>(cb: (tx: Handle) => Promise<T>): Promise<T> {
      if (depth === 0) {
        exec('BEGIN');
        try {
          const result = await cb(handle('tx', 1));
          exec('COMMIT');
          return result;
        } catch (error) {
          exec('ROLLBACK');
          throw error;
        }
      }
      const name = `sp_${++savepoints}`;
      exec(`SAVEPOINT ${name}`);
      try {
        const result = await cb(handle(`savepoint:${name}`, depth + 1));
        exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        exec(`ROLLBACK TO ${name}`);
        throw error;
      }
    },
  });

  return { db: handle('root', 0), sqlite, statements };
}

describe('createTransactionalDb / runInTransaction', () => {
  let raw: Handle;
  let db: Handle;
  let statements: string[];

  beforeEach(() => {
    const made = makeDb();
    raw = made.db;
    statements = made.statements;
    db = createTransactionalDb(raw);
  });

  it('outside a transaction the handle is the database', () => {
    expect(db.label).toBe('root');
    expect(isTransactionalDb(db)).toBe(true);
    expect(isTransactionalDb(raw)).toBe(false);
    expect(isInTransaction(db)).toBe(false);
    db.insert('a');
    expect(db.names()).toEqual(['a']);
    expect(statements).toEqual([]);
  });

  it('inside runInTransaction the same handle is the transaction', async () => {
    let labelInside = '';
    await runInTransaction(db, async () => {
      labelInside = db.label;
      expect(isInTransaction(db)).toBe(true);
      expect(getActiveTransaction<Handle>(db)?.label).toBe('tx');
    });
    expect(labelInside).toBe('tx');
    expect(db.label).toBe('root');
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('commits what was written when the callback resolves', async () => {
    await runInTransaction(db, async () => {
      db.insert('a');
      db.insert('b');
    });
    expect(raw.names()).toEqual(['a', 'b']);
  });

  it('rolls back everything when the callback throws, and rethrows', async () => {
    await expect(
      runInTransaction(db, async () => {
        db.insert('a');
        db.insert('b');
        throw new Error('nope');
      })
    ).rejects.toThrow('nope');

    expect(raw.names()).toEqual([]);
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('covers code that holds its own reference to the handle (a service called from inside)', async () => {
    class Inventory {
      constructor(private db: Handle) {}
      async reserve(name: string) {
        await Promise.resolve();
        this.db.insert(name);
      }
    }
    const inventory = new Inventory(db);

    await expect(
      runInTransaction(db, async () => {
        db.insert('order');
        await inventory.reserve('stock');
        throw new Error('payment failed');
      })
    ).rejects.toThrow('payment failed');

    // Both writes rolled back, though Inventory never saw a `tx` argument
    expect(raw.names()).toEqual([]);
  });

  it('a nested call joins the active transaction by default', async () => {
    await runInTransaction(db, async () => {
      db.insert('outer');
      await runInTransaction(db, async () => {
        db.insert('inner');
      });
    });
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
    expect(raw.names()).toEqual(['outer', 'inner']);
  });

  it('nested: true opens a savepoint whose failure can be contained', async () => {
    await runInTransaction(db, async () => {
      db.insert('kept');
      await runInTransaction(db, async () => {
        db.insert('discarded');
        throw new Error('inner failed');
      }, { nested: true }).catch(() => {});
      db.insert('also kept');
    });

    expect(raw.names()).toEqual(['kept', 'also kept']);
    expect(statements).toEqual(['BEGIN', 'SAVEPOINT sp_1', 'ROLLBACK TO sp_1', 'COMMIT']);
  });

  it('db.transaction() on the handle is ambient too', async () => {
    await expect(
      db.transaction(async () => {
        db.insert('a'); // through the handle, not the callback argument
        throw new Error('nope');
      })
    ).rejects.toThrow('nope');
    expect(raw.names()).toEqual([]);
  });

  it('work that outlives the transaction uses the database, not the finished transaction', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let lateLabel = '';
    let late!: Promise<void>;

    await runInTransaction(db, async () => {
      db.insert('in-tx');
      // Started inside, deliberately not awaited: finishes after the commit
      late = gate.then(() => {
        lateLabel = db.label;
        db.insert('late');
      });
    });

    release();
    await late;

    expect(lateLabel).toBe('root');
    expect(raw.names()).toEqual(['in-tx', 'late']);
  });

  it('concurrent transactions on separate call chains do not see each other', async () => {
    // Two independent databases, so the two transactions can overlap in time
    const a = makeDb();
    const b = makeDb();
    const dbA = createTransactionalDb(a.db);
    const dbB = createTransactionalDb(b.db);

    const seen: string[] = [];
    await Promise.all([
      runInTransaction(dbA, async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(`A sees A:${isInTransaction(dbA)} B:${isInTransaction(dbB)}`);
      }),
      runInTransaction(dbB, async () => {
        seen.push(`B sees A:${isInTransaction(dbA)} B:${isInTransaction(dbB)}`);
      }),
    ]);

    expect(seen.sort()).toEqual(['A sees A:true B:false', 'B sees A:false B:true']);
  });

  it('wrapping twice returns the same handle', () => {
    expect(createTransactionalDb(db)).toBe(db);
  });

  it('runs onBegin once per outermost transaction, inside it, before the callback', async () => {
    const made = makeDb();
    const order: string[] = [];
    const hooked = createTransactionalDb(made.db, {
      onBegin: (tx) => { order.push(`begin:${(tx as Handle).label}`); (tx as Handle).insert('from-hook'); },
    });

    await runInTransaction(hooked, async () => {
      order.push('body');
      await runInTransaction(hooked, async () => { order.push('joined'); });
      await runInTransaction(hooked, async () => { order.push('savepoint'); }, { nested: true });
    });

    expect(order).toEqual(['begin:tx', 'body', 'joined', 'savepoint']);
    expect(made.db.names()).toEqual(['from-hook']);
  });
});

describe('@Transactional with an injected handle', () => {
  async function build() {
    const made = makeDb();
    const app = new VeloceTS({ docs: false });
    const handle = registerDrizzle(app, made.db);

    class Ledger {
      constructor(@InjectDB() private db: Handle) {}

      @Transactional()
      async transfer(fail: boolean) {
        this.db.insert('debit');
        await Promise.resolve();
        if (fail) throw new BadRequestException('insufficient funds');
        this.db.insert('credit');
        return 'ok';
      }
    }

    // A singleton controller that captured `this.db` in its constructor —
    // the case the previous @Transactional silently left outside the transaction.
    @Controller('/ledger')
    class LedgerController {
      constructor(@InjectDB() private db: Handle, @Inject(Ledger) private ledger: Ledger) {}

      @Post('/ok')
      ok() { return this.ledger.transfer(false); }

      @Post('/fail')
      fail() { return this.ledger.transfer(true); }

      @Post('/direct')
      @Transactional()
      async direct() {
        this.db.insert('one');
        throw new BadRequestException('stop');
      }

      @Get('/names')
      names() { return this.db.names(); }
    }

    app.include(LedgerController);
    await app.compile();
    const call = (method: string, path: string) => app.getHono().request(path, { method });
    return { made, handle, call };
  }

  it('registerDrizzle injects a transaction-aware handle and returns it', async () => {
    const { handle } = await build();
    expect(isTransactionalDb(handle)).toBe(true);
  });

  it('commits a successful method', async () => {
    const { made, call } = await build();
    expect((await call('POST', '/ledger/ok')).status).toBe(200);
    expect(made.db.names()).toEqual(['debit', 'credit']);
    expect(made.statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back a failing service method: the first write does not survive', async () => {
    const { made, call } = await build();
    expect((await call('POST', '/ledger/fail')).status).toBe(400);
    expect(made.db.names()).toEqual([]);
    expect(made.statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('works directly on a handler of a singleton controller', async () => {
    const { made, call } = await build();
    expect((await call('POST', '/ledger/direct')).status).toBe(400);
    expect(made.db.names()).toEqual([]);
  });
});

describe('registerDrizzle transactionPerRequest', () => {
  async function build(options: Parameters<typeof registerDrizzle>[2]) {
    const made = makeDb();
    const app = new VeloceTS({ docs: false });
    registerDrizzle(app, made.db, options);

    @Controller('/req')
    class C {
      constructor(@InjectDB() private db: Handle) {}

      @Post('/ok')
      ok() { this.db.insert('a'); this.db.insert('b'); return { ok: true }; }

      @Post('/throws')
      throws() { this.db.insert('a'); throw new BadRequestException('bad'); }

      @Post('/crash')
      crash() { this.db.insert('a'); throw new Error('unexpected'); }

      @Post('/returns-400')
      returns400() { this.db.insert('kept'); return new Response('no', { status: 400 }); }

      @Get('/read')
      read() { return { inTx: this.db.label }; }
    }

    app.include(C);
    await app.compile();
    const call = (method: string, path: string, headers: Record<string, string> = {}) =>
      app.getHono().request(path, { method, headers });
    return { made, call };
  }

  it('commits a successful request as one transaction', async () => {
    const { made, call } = await build({ transactionPerRequest: true });
    expect((await call('POST', '/req/ok')).status).toBe(200);
    expect(made.db.names()).toEqual(['a', 'b']);
    expect(made.statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back when the handler throws an HTTP exception, and still answers 400', async () => {
    const { made, call } = await build({ transactionPerRequest: true });
    const res = await call('POST', '/req/throws');
    expect(res.status).toBe(400);
    expect(made.db.names()).toEqual([]);
    expect(made.statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('rolls back on an unexpected error (500)', async () => {
    const { made, call } = await build({ transactionPerRequest: true });
    expect((await call('POST', '/req/crash')).status).toBe(500);
    expect(made.db.names()).toEqual([]);
  });

  it('a 4xx the handler chose to return (not throw) commits', async () => {
    const { made, call } = await build({ transactionPerRequest: true });
    expect((await call('POST', '/req/returns-400')).status).toBe(400);
    expect(made.db.names()).toEqual(['kept']);
  });

  it('honors the predicate', async () => {
    const { made, call } = await build({ transactionPerRequest: (c) => c.req.method !== 'GET' });
    expect(await (await call('GET', '/req/read')).json()).toEqual({ inTx: 'root' });
    expect(made.statements).toEqual([]);
    await call('POST', '/req/ok');
    expect(made.statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('never wraps an event-stream request', async () => {
    const { made, call } = await build({ transactionPerRequest: true });
    await call('GET', '/req/read', { Accept: 'text/event-stream' });
    expect(made.statements).toEqual([]);
  });

  it('is off by default', async () => {
    const { made, call } = await build(undefined);
    await call('POST', '/req/ok');
    expect(made.statements).toEqual([]);
    expect(made.db.names()).toEqual(['a', 'b']);
  });

  it('onBegin receives the request, before the handler runs', async () => {
    const order: string[] = [];
    const made = makeDb();
    const app = new VeloceTS({ docs: false });
    registerDrizzle(app, made.db, {
      transactionPerRequest: true,
      onBegin: (tx, c) => {
        order.push(`begin tenant=${c?.req.header('X-Tenant')}`);
        (tx as Handle).insert(`tenant:${c?.req.header('X-Tenant')}`);
      },
    });

    @Controller('/hook')
    class C {
      constructor(@InjectDB() private db: Handle) {}
      @Post('/')
      handler() { order.push('handler'); return this.db.names(); }
    }
    app.include(C);
    await app.compile();

    const res = await app.getHono().request('/hook', { method: 'POST', headers: { 'X-Tenant': 'acme' } });
    expect(order).toEqual(['begin tenant=acme', 'handler']);
    // The handler saw what the hook wrote, in the same transaction
    expect(await res.json()).toEqual(['tenant:acme']);
  });

  it('onBegin without transactionPerRequest still gets the request for @Transactional', async () => {
    let tenant: string | undefined;
    const made = makeDb();
    const app = new VeloceTS({ docs: false });
    registerDrizzle(app, made.db, { onBegin: (_tx, c) => { tenant = c?.req.header('X-Tenant'); } });

    @Controller('/hook2')
    class C {
      constructor(@InjectDB() private db: Handle) {}
      @Post('/')
      @Transactional()
      async handler() { this.db.insert('x'); return { ok: true }; }
    }
    app.include(C);
    await app.compile();

    await app.getHono().request('/hook2', { method: 'POST', headers: { 'X-Tenant': 'globex' } });
    expect(tenant).toBe('globex');
    expect(made.statements).toEqual(['BEGIN', 'COMMIT']);
  });
});
