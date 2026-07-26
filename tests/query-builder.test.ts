/**
 * QueryBuilder tests: verifies the QueryDefinition produced for
 * where/orderBy/limit/offset/select combinations and delegation
 * to the QueryExecutor.
 */
import { describe, it, expect } from 'bun:test';
import {
  QueryBuilder,
  QueryBuilderFactory,
  QueryDefinition,
  QueryExecutor,
  DefaultQueryOperators,
} from '../src/orm/query-builder';

interface User {
  id: number;
  name: string;
  age: number;
}

class FakeExecutor implements QueryExecutor<User> {
  lastExecuteQuery?: QueryDefinition;
  lastCountQuery?: QueryDefinition;

  constructor(
    private rows: User[] = [],
    private countValue = 0
  ) {}

  async execute(query: QueryDefinition): Promise<User[]> {
    this.lastExecuteQuery = query;
    return this.rows;
  }

  async count(query: QueryDefinition): Promise<number> {
    this.lastCountQuery = query;
    return this.countValue;
  }
}

function builder(rows: User[] = [], count = 0) {
  const executor = new FakeExecutor(rows, count);
  return { executor, qb: new QueryBuilder<User>(executor) };
}

describe('QueryBuilder — QueryDefinition construction', () => {
  it('empty builder produces an empty definition', async () => {
    const { executor, qb } = builder();
    await qb.execute();

    const query = executor.lastExecuteQuery!;
    expect(query.select).toBeUndefined();
    expect(query.where).toBeUndefined();
    expect(query.orderBy).toBeUndefined();
    expect(query.limit).toBeUndefined();
    expect(query.offset).toBeUndefined();
    expect(query.joins).toEqual([]);
  });

  it('select() sets the selected fields', async () => {
    const { executor, qb } = builder();
    await qb.select(['id', 'name']).execute();
    expect(executor.lastExecuteQuery!.select).toEqual(['id', 'name']);
  });

  it('where() with a scalar builds an eq condition', async () => {
    const { executor, qb } = builder();
    await qb.where({ name: 'Ana' }).execute();
    expect(executor.lastExecuteQuery!.where).toEqual({ type: 'eq', field: 'name', value: 'Ana' });
  });

  it('where() with null/undefined builds isNull', async () => {
    const { executor, qb } = builder();
    await qb.where({ name: null }).execute();
    expect(executor.lastExecuteQuery!.where).toEqual({ type: 'isNull', field: 'name' });
  });

  it('where() with an array builds an in condition', async () => {
    const { executor, qb } = builder();
    await qb.where({ age: [20, 30] }).execute();
    expect(executor.lastExecuteQuery!.where).toEqual({
      type: 'in',
      field: 'age',
      values: [20, 30],
    });
  });

  it('where() supports comparison operators', async () => {
    const cases: Array<[any, any]> = [
      [{ age: { eq: 30 } }, { type: 'eq', field: 'age', value: 30 }],
      [{ age: { ne: 30 } }, { type: 'ne', field: 'age', value: 30 }],
      [{ age: { gt: 18 } }, { type: 'gt', field: 'age', value: 18 }],
      [{ age: { gte: 18 } }, { type: 'gte', field: 'age', value: 18 }],
      [{ age: { lt: 65 } }, { type: 'lt', field: 'age', value: 65 }],
      [{ age: { lte: 65 } }, { type: 'lte', field: 'age', value: 65 }],
      [{ name: { like: '%an%' } }, { type: 'like', field: 'name', pattern: '%an%' }],
      [{ name: { ilike: '%AN%' } }, { type: 'ilike', field: 'name', pattern: '%AN%' }],
      [{ age: { in: [1, 2] } }, { type: 'in', field: 'age', values: [1, 2] }],
      [{ age: { notIn: [3, 4] } }, { type: 'notIn', field: 'age', values: [3, 4] }],
      [{ age: { between: [18, 65] } }, { type: 'between', field: 'age', min: 18, max: 65 }],
    ];

    for (const [input, expected] of cases) {
      const { executor, qb } = builder();
      await qb.where(input).execute();
      expect(executor.lastExecuteQuery!.where).toEqual(expected);
    }
  });

  it('where() with multiple fields combines them with and', async () => {
    const { executor, qb } = builder();
    await qb.where({ name: 'Ana', age: { gte: 18 } }).execute();
    expect(executor.lastExecuteQuery!.where).toEqual({
      type: 'and',
      conditions: [
        { type: 'eq', field: 'name', value: 'Ana' },
        { type: 'gte', field: 'age', value: 18 },
      ],
    });
  });

  it('multiple where() calls are combined with a top-level and', async () => {
    const { executor, qb } = builder();
    await qb.where({ name: 'Ana' }).where({ age: 30 }).execute();
    expect(executor.lastExecuteQuery!.where).toEqual({
      type: 'and',
      conditions: [
        { type: 'eq', field: 'name', value: 'Ana' },
        { type: 'eq', field: 'age', value: 30 },
      ],
    });
  });

  it('orderBy() accepts a single sort and an array of sorts', async () => {
    const single = builder();
    await single.qb.orderBy({ field: 'age', direction: 'desc' }).execute();
    expect(single.executor.lastExecuteQuery!.orderBy).toEqual({ field: 'age', direction: 'desc' });

    const multi = builder();
    const sorts = [
      { field: 'age', direction: 'desc' as const },
      { field: 'name', direction: 'asc' as const },
    ];
    await multi.qb.orderBy(sorts).execute();
    expect(multi.executor.lastExecuteQuery!.orderBy).toEqual(sorts);
  });

  it('limit() and offset() are carried into the definition', async () => {
    const { executor, qb } = builder();
    await qb.limit(10).offset(20).execute();
    expect(executor.lastExecuteQuery!.limit).toBe(10);
    expect(executor.lastExecuteQuery!.offset).toBe(20);
  });

  it('groupBy() and having() are carried into the definition', async () => {
    const { executor, qb } = builder();
    await qb
      .groupBy(['age'])
      .having({ age: { gt: 1 } })
      .execute();
    expect(executor.lastExecuteQuery!.groupBy).toEqual(['age']);
    expect(executor.lastExecuteQuery!.having).toEqual({ type: 'gt', field: 'age', value: 1 });
  });

  it('join helpers accumulate typed join clauses', async () => {
    const { executor, qb } = builder();
    await qb
      .join('orders', 'orders.user_id = users.id')
      .leftJoin('profiles', 'profiles.user_id = users.id')
      .rightJoin('logs', 'logs.user_id = users.id')
      .innerJoin('roles', 'roles.user_id = users.id')
      .execute();

    expect(executor.lastExecuteQuery!.joins).toEqual([
      { type: 'JOIN', table: 'orders', condition: 'orders.user_id = users.id' },
      { type: 'LEFT JOIN', table: 'profiles', condition: 'profiles.user_id = users.id' },
      { type: 'RIGHT JOIN', table: 'logs', condition: 'logs.user_id = users.id' },
      { type: 'INNER JOIN', table: 'roles', condition: 'roles.user_id = users.id' },
    ]);
  });

  it('is chainable and reusable across executions', async () => {
    const { executor, qb } = builder();
    qb.where({ age: 30 }).limit(5);

    await qb.execute();
    expect(executor.lastExecuteQuery!.limit).toBe(5);

    await qb.execute();
    expect(executor.lastExecuteQuery!.limit).toBe(5);
    expect(executor.lastExecuteQuery!.where).toEqual({ type: 'eq', field: 'age', value: 30 });
  });
});

describe('QueryBuilder — executor delegation', () => {
  const rows: User[] = [
    { id: 1, name: 'Ana', age: 30 },
    { id: 2, name: 'Bruno', age: 25 },
  ];

  it('execute() returns the executor rows', async () => {
    const { qb } = builder(rows);
    expect(await qb.execute()).toEqual(rows);
  });

  it('first() applies limit 1, returns the first row and restores the limit', async () => {
    const { executor, qb } = builder(rows);
    qb.limit(50);

    const first = await qb.first();
    expect(first).toEqual(rows[0]);
    expect(executor.lastExecuteQuery!.limit).toBe(1);

    await qb.execute();
    expect(executor.lastExecuteQuery!.limit).toBe(50);
  });

  it('first() returns null when there are no rows', async () => {
    const { qb } = builder([]);
    expect(await qb.first()).toBeNull();
  });

  it('count() delegates to executor.count with a COUNT(*) definition', async () => {
    const { executor, qb } = builder([], 42);
    const total = await qb
      .where({ age: { gte: 18 } })
      .orderBy({ field: 'age', direction: 'asc' })
      .limit(10)
      .count();

    expect(total).toBe(42);
    const query = executor.lastCountQuery!;
    expect(query.select).toEqual(['COUNT(*) as count']);
    expect(query.where).toEqual({ type: 'gte', field: 'age', value: 18 });
    // Count queries must not carry ordering or pagination
    expect(query.orderBy).toBeUndefined();
    expect(query.limit).toBeUndefined();
    expect(query.offset).toBeUndefined();
  });

  it('exists() is true when count > 0 and false otherwise', async () => {
    const some = builder([], 3);
    expect(await some.qb.exists()).toBe(true);

    const none = builder([], 0);
    expect(await none.qb.exists()).toBe(false);
  });
});

describe('DefaultQueryOperators', () => {
  const ops = new DefaultQueryOperators();

  it('builds scalar conditions', () => {
    expect(ops.eq(1)).toEqual({ type: 'eq', value: 1 });
    expect(ops.ne(1)).toEqual({ type: 'ne', value: 1 });
    expect(ops.gt(1)).toEqual({ type: 'gt', value: 1 });
    expect(ops.gte(1)).toEqual({ type: 'gte', value: 1 });
    expect(ops.lt(1)).toEqual({ type: 'lt', value: 1 });
    expect(ops.lte(1)).toEqual({ type: 'lte', value: 1 });
    expect(ops.like('%a%')).toEqual({ type: 'like', pattern: '%a%' });
    expect(ops.ilike('%a%')).toEqual({ type: 'ilike', pattern: '%a%' });
    expect(ops.in([1, 2])).toEqual({ type: 'in', values: [1, 2] });
    expect(ops.notIn([1, 2])).toEqual({ type: 'notIn', values: [1, 2] });
    expect(ops.between(1, 9)).toEqual({ type: 'between', min: 1, max: 9 });
    expect(ops.isNull()).toEqual({ type: 'isNull' });
    expect(ops.isNotNull()).toEqual({ type: 'isNotNull' });
  });

  it('builds logical combinators', () => {
    const a = ops.eq(1);
    const b = ops.gt(2);
    expect(ops.and(a, b)).toEqual({ type: 'and', conditions: [a, b] });
    expect(ops.or(a, b)).toEqual({ type: 'or', conditions: [a, b] });
    expect(ops.not(a)).toEqual({ type: 'not', condition: a });
  });
});

describe('QueryBuilderFactory', () => {
  it('create() returns a working QueryBuilder', async () => {
    const executor = new FakeExecutor([{ id: 1, name: 'Ana', age: 30 }]);
    const qb = QueryBuilderFactory.create<User>(executor);
    expect(qb).toBeInstanceOf(QueryBuilder);
    expect(await qb.execute()).toHaveLength(1);
  });

  it('createWithOperators() accepts custom operators', async () => {
    const executor = new FakeExecutor();
    const qb = QueryBuilderFactory.createWithOperators<User>(executor, new DefaultQueryOperators());
    await qb.where({ id: 1 }).execute();
    expect(executor.lastExecuteQuery!.where).toEqual({ type: 'eq', field: 'id', value: 1 });
  });
});
