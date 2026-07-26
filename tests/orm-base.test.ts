/**
 * BaseRepository behavior tests.
 *
 * Uses a minimal in-memory repository (the same way real adapters extend
 * BaseRepository, see repository-factory.ts) to exercise the shared CRUD
 * surface, and a "bare" repository that only implements the abstract methods
 * to verify that the base count/updateMany/deleteMany throw NotImplementedError
 * instead of silently scanning the whole table.
 */
import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  BaseRepository,
  FindOptions,
  FilterOptions,
} from '../src/orm/base-repository';
import { NotImplementedError } from '../src/orm/errors';
import { RepositoryFactory, RepositoryRegistry } from '../src/orm/repository-factory';
import { PrismaRepository } from '../src/orm/prisma/repository';
import { TypeORMRepository } from '../src/orm/typeorm/repository';

interface User {
  id: number;
  name: string;
  age: number;
}

/** Matches only flat equality filters — enough for these tests. */
function matches(row: any, where?: FilterOptions): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

/**
 * Bare repository: implements ONLY the abstract methods.
 * Inherits base count/updateMany/deleteMany, which must throw.
 */
class BareRepository extends BaseRepository<User, number> {
  private store = new Map<number, User>();
  private nextId = 1;

  async create(data: Partial<User>): Promise<User> {
    // Same pattern as the real adapters: run the entity through validate()
    const user = this.validate({ id: this.nextId++, ...data });
    this.store.set(user.id, user);
    return user;
  }

  async findById(id: number): Promise<User | null> {
    return this.store.get(id) ?? null;
  }

  async findOne(options: FindOptions): Promise<User | null> {
    const all = await this.findMany(options);
    return all[0] ?? null;
  }

  async findMany(options?: FindOptions): Promise<User[]> {
    let rows = [...this.store.values()].filter(row => matches(row, options?.where));

    const orderBy = options?.orderBy;
    if (orderBy && !Array.isArray(orderBy)) {
      const dir = orderBy.direction === 'desc' ? -1 : 1;
      rows = rows.sort((a: any, b: any) =>
        a[orderBy.field] < b[orderBy.field] ? -dir : a[orderBy.field] > b[orderBy.field] ? dir : 0
      );
    }

    const offset = options?.pagination?.offset ?? 0;
    const limit = options?.pagination?.limit;
    if (offset || limit !== undefined) {
      rows = rows.slice(offset, limit !== undefined ? offset + limit : undefined);
    }

    return rows;
  }

  async update(id: number, data: Partial<User>): Promise<User> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Entity with id ${id} not found`);
    const updated = { ...existing, ...data };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: number): Promise<boolean> {
    return this.store.delete(id);
  }
}

/**
 * In-memory repository shaped like a real adapter: overrides
 * count/updateMany/deleteMany with "native" (non-scanning) implementations.
 */
class InMemoryRepository extends BareRepository {
  async count(where?: FilterOptions): Promise<number> {
    return (await this.findMany({ where })).length;
  }

  async updateMany(where: FilterOptions, data: Partial<User>): Promise<number> {
    const rows = await this.findMany({ where });
    for (const row of rows) await this.update(row.id, data);
    return rows.length;
  }

  async deleteMany(where: FilterOptions): Promise<number> {
    const rows = await this.findMany({ where });
    for (const row of rows) await this.delete(row.id);
    return rows.length;
  }
}

describe('BaseRepository CRUD (in-memory adapter)', () => {
  async function seeded(): Promise<InMemoryRepository> {
    const repo = new InMemoryRepository();
    await repo.create({ name: 'Ana', age: 30 });
    await repo.create({ name: 'Bruno', age: 25 });
    await repo.create({ name: 'Carla', age: 30 });
    return repo;
  }

  it('create() assigns an id and stores the entity', async () => {
    const repo = new InMemoryRepository();
    const user = await repo.create({ name: 'Ana', age: 30 });
    expect(user.id).toBe(1);
    expect(user.name).toBe('Ana');
  });

  it('findById() returns the entity or null', async () => {
    const repo = await seeded();
    expect((await repo.findById(2))?.name).toBe('Bruno');
    expect(await repo.findById(999)).toBeNull();
  });

  it('findOne() applies where filters', async () => {
    const repo = await seeded();
    const user = await repo.findOne({ where: { name: 'Carla' } });
    expect(user?.age).toBe(30);
  });

  it('findMany() filters, sorts and paginates', async () => {
    const repo = await seeded();

    expect(await repo.findMany()).toHaveLength(3);
    expect(await repo.findMany({ where: { age: 30 } })).toHaveLength(2);

    const sorted = await repo.findMany({ orderBy: { field: 'age', direction: 'asc' } });
    expect(sorted[0].name).toBe('Bruno');

    const page = await repo.findMany({ pagination: { limit: 1, offset: 1 } });
    expect(page).toHaveLength(1);
  });

  it('update() merges changes and throws for missing ids', async () => {
    const repo = await seeded();
    const updated = await repo.update(1, { age: 31 });
    expect(updated).toEqual({ id: 1, name: 'Ana', age: 31 });
    await expect(repo.update(999, { age: 1 })).rejects.toThrow('not found');
  });

  it('delete() returns true when removed, false when absent', async () => {
    const repo = await seeded();
    expect(await repo.delete(1)).toBe(true);
    expect(await repo.delete(1)).toBe(false);
  });

  it('createMany() default creates each entity', async () => {
    const repo = new InMemoryRepository();
    const users = await repo.createMany([
      { name: 'A', age: 1 },
      { name: 'B', age: 2 },
    ]);
    expect(users.map(u => u.id)).toEqual([1, 2]);
    expect(await repo.count()).toBe(2);
  });

  it('exists() default delegates to findOne()', async () => {
    const repo = await seeded();
    expect(await repo.exists({ name: 'Ana' })).toBe(true);
    expect(await repo.exists({ name: 'Nobody' })).toBe(false);
  });

  it('findPaginated() default computes correct metadata', async () => {
    const repo = new InMemoryRepository();
    for (let i = 1; i <= 5; i++) await repo.create({ name: `u${i}`, age: i });

    const result = await repo.findPaginated({
      pagination: { page: 2, limit: 2, offset: 0 },
      orderBy: { field: 'age', direction: 'asc' },
    });

    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrev).toBe(true);
    expect(result.data.map(u => u.age)).toEqual([3, 4]);
  });

  it('withTransaction() default runs the callback with the same repo', async () => {
    const repo = await seeded();
    const result = await repo.withTransaction(async r => {
      expect(r).toBe(repo);
      return 'done';
    });
    expect(result).toBe('done');
  });
});

describe('BaseRepository validation', () => {
  const schema = z.object({
    id: z.number(),
    name: z.string(),
    age: z.number().int().nonnegative(),
  });

  class ValidatedRepository extends InMemoryRepository {
    constructor() {
      super(schema as z.ZodSchema<User>);
    }
  }

  it('create() returns schema-validated entities', async () => {
    const repo = new ValidatedRepository();
    const user = await repo.create({ name: 'Ana', age: 30 });
    expect(schema.safeParse(user).success).toBe(true);
  });

  it('create() throws when the stored entity violates the schema', async () => {
    const repo = new ValidatedRepository();
    await expect(repo.create({ name: 'Ana', age: -5 })).rejects.toThrow();
  });
});

describe('BaseRepository footgun guards (NotImplementedError)', () => {
  it('base count() throws NotImplementedError instead of scanning all rows', async () => {
    const repo = new BareRepository();
    await repo.create({ name: 'Ana', age: 30 });

    expect(repo.count()).rejects.toBeInstanceOf(NotImplementedError);
    await expect(repo.count({ age: 30 })).rejects.toThrow(/count\(\).*not implemented/);
  });

  it('base updateMany() throws NotImplementedError instead of fetch-then-loop', async () => {
    const repo = new BareRepository();
    await expect(repo.updateMany({ age: 30 }, { age: 31 })).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });

  it('base deleteMany() throws NotImplementedError instead of fetch-then-loop', async () => {
    const repo = new BareRepository();
    await expect(repo.deleteMany({ age: 30 })).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('error message tells the user to override in the adapter', async () => {
    try {
      await new BareRepository().count();
      expect.unreachable();
    } catch (error: any) {
      expect(error.name).toBe('NotImplementedError');
      expect(error.method).toBe('count()');
      expect(error.message).toContain('Override count()');
      expect(error.message).toContain('DrizzleRepository');
    }
  });

  it('default findPaginated() propagates the count() error for bare repos', async () => {
    const repo = new BareRepository();
    await expect(
      repo.findPaginated({ pagination: { page: 1, limit: 10, offset: 0 } })
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('adapter-style overrides are unaffected', async () => {
    const repo = new InMemoryRepository();
    await repo.create({ name: 'Ana', age: 30 });
    await repo.create({ name: 'Bea', age: 30 });

    expect(await repo.count({ age: 30 })).toBe(2);
    expect(await repo.updateMany({ age: 30 }, { age: 40 })).toBe(2);
    expect(await repo.deleteMany({ age: 40 })).toBe(2);
    expect(await repo.count()).toBe(0);
  });
});

describe('RepositoryFactory / RepositoryRegistry', () => {
  it('getInstance() returns a singleton', () => {
    expect(RepositoryFactory.getInstance()).toBe(RepositoryFactory.getInstance());
  });

  it('createRepository() rejects unsupported types', () => {
    const factory = RepositoryFactory.getInstance();
    expect(() => factory.createRepository('mongo' as any, {})).toThrow(
      'Unsupported repository type: mongo'
    );
  });

  it('createPrismaRepository() and createTypeORMRepository() return adapter instances', () => {
    const factory = RepositoryFactory.getInstance();

    const prismaRepo = factory.createPrismaRepository({
      client: {},
      delegate: {},
      model: 'User',
    });
    expect(prismaRepo).toBeInstanceOf(PrismaRepository);
    expect(prismaRepo).toBeInstanceOf(BaseRepository);

    const typeormRepo = factory.createTypeORMRepository({
      dataSource: {},
      repository: {},
      entity: class {},
    });
    expect(typeormRepo).toBeInstanceOf(TypeORMRepository);
    expect(typeormRepo).toBeInstanceOf(BaseRepository);
  });

  it('registry registers, retrieves, removes and clears repositories', () => {
    const registry = new RepositoryRegistry();
    const repo = new InMemoryRepository();

    registry.register('users', repo);
    expect(registry.get('users')).toBe(repo);
    expect(registry.getNames()).toEqual(['users']);
    expect(registry.size()).toBe(1);

    expect(registry.remove('users')).toBe(true);
    expect(registry.get('users')).toBeUndefined();

    registry.register('a', repo);
    registry.register('b', repo);
    registry.clear();
    expect(registry.size()).toBe(0);
  });
});
