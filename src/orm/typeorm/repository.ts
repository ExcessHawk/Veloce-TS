import { z } from 'zod';
import { BaseRepository, FindOptions, FilterOptions, SortOptions, PaginationOptions, PaginatedResult } from '../base-repository';
import { TypeORMRepositoryOptions, DataSourceLike, RepositoryLike, EntityManagerLike } from './types';

/**
 * TypeORM-specific repository implementation
 */
export class TypeORMRepository<T, ID = string | number> extends BaseRepository<T, ID> {
  protected dataSource: DataSourceLike;
  protected repository: RepositoryLike<T>;
  protected entity: any;
  
  constructor(options: TypeORMRepositoryOptions<T>) {
    super(options.zodSchema);
    this.dataSource = options.dataSource;
    this.repository = options.repository;
    this.entity = options.entity;
  }
  
  async create(data: Partial<T>): Promise<T> {
    const validatedData = this.validatePartial(data);
    const entity = this.repository.create(validatedData);
    const saved = await this.repository.save(entity);
    return this.validate(saved);
  }
  
  async findById(id: ID): Promise<T | null> {
    const result = await this.repository.findOneBy({ id } as any);
    return result ? this.validate(result) : null;
  }
  
  async findOne(options: FindOptions): Promise<T | null> {
    const typeormOptions = this.buildTypeORMFindOptions(options);
    const result = await this.repository.findOne(typeormOptions);
    return result ? this.validate(result) : null;
  }
  
  async findMany(options?: FindOptions): Promise<T[]> {
    const typeormOptions = this.buildTypeORMFindOptions(options || {});
    const results = await this.repository.find(typeormOptions);
    return results.map(result => this.validate(result));
  }
  
  async update(id: ID, data: Partial<T>): Promise<T> {
    const validatedData = this.validatePartial(data);
    
    // First find the entity
    const entity = await this.repository.findOneBy({ id } as any);
    if (!entity) {
      throw new Error(`Entity with id ${id} not found`);
    }
    
    // Merge the changes
    const merged = this.repository.merge(entity, validatedData);
    const saved = await this.repository.save(merged);
    return this.validate(saved);
  }
  
  async delete(id: ID): Promise<boolean> {
    const result = await this.repository.delete({ id } as any);
    return (result.affected || 0) > 0;
  }
  
  // Optimized bulk operations using TypeORM's native methods
  async createMany(data: Partial<T>[]): Promise<T[]> {
    const validatedData = data.map(item => this.validatePartial(item));
    const entities = validatedData.map(item => this.repository.create(item));
    const saved = await this.repository.save(entities);
    return saved.map(item => this.validate(item));
  }
  
  async updateMany(where: FilterOptions, data: Partial<T>): Promise<number> {
    const validatedData = this.validatePartial(data);
    const whereClause = this.buildWhereClause(where);
    const result = await this.repository.update(whereClause, validatedData);
    return result.affected || 0;
  }
  
  async deleteMany(where: FilterOptions): Promise<number> {
    const whereClause = this.buildWhereClause(where);
    const result = await this.repository.delete(whereClause);
    return result.affected || 0;
  }
  
  async count(where?: FilterOptions): Promise<number> {
    const typeormOptions = where ? { where: this.buildWhereClause(where) } : {};
    return await this.repository.count(typeormOptions);
  }
  
  async exists(where: FilterOptions): Promise<boolean> {
    const count = await this.repository.count({
      where: this.buildWhereClause(where),
      take: 1
    });
    return count > 0;
  }
  
  // Optimized pagination using TypeORM's native pagination
  async findPaginated(options: FindOptions & { pagination: Required<PaginationOptions> }): Promise<PaginatedResult<T>> {
    const { pagination, ...findOptions } = options;
    const { page, limit } = pagination;
    
    // Calculate skip
    const skip = (page - 1) * limit;
    
    // Build TypeORM options
    const typeormOptions = this.buildTypeORMFindOptions(findOptions);
    typeormOptions.skip = skip;
    typeormOptions.take = limit;
    
    // Get data and count in one query
    const [data, total] = await this.repository.createQueryBuilder('entity')
      .where(typeormOptions.where || {})
      .orderBy(typeormOptions.order || {})
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    
    const validatedData = data.map(item => this.validate(item));
    const totalPages = Math.ceil(total / limit);
    
    return {
      data: validatedData,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    };
  }
  
  // Transaction support using TypeORM's transaction API
  async withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return await this.dataSource.transaction(async (manager: EntityManagerLike) => {
      // Create a new repository instance with the transaction manager
      const transactionalRepo = manager.getRepository ? manager.getRepository(this.entity) : this.repository;
      const transactionalInstance = new (this.constructor as any)({
        dataSource: this.dataSource,
        repository: transactionalRepo,
        entity: this.entity,
        zodSchema: this.schema
      });
      
      return await callback(transactionalInstance as this);
    });
  }
  
  // Build TypeORM-specific find options
  private buildTypeORMFindOptions(options: FindOptions): any {
    const typeormOptions: any = {};
    
    if (options.where) {
      typeormOptions.where = this.buildWhereClause(options.where);
    }
    
    if (options.orderBy) {
      typeormOptions.order = this.buildOrderByClause(options.orderBy);
    }
    
    if (options.pagination) {
      if (options.pagination.limit) {
        typeormOptions.take = options.pagination.limit;
      }
      if (options.pagination.offset) {
        typeormOptions.skip = options.pagination.offset;
      }
    }
    
    if (options.include) {
      typeormOptions.relations = options.include;
    }
    
    if (options.select) {
      typeormOptions.select = options.select.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {} as any);
    }
    
    return typeormOptions;
  }
  
  // Override base class methods for TypeORM-specific implementations
  protected buildWhereClause(where: FilterOptions): any {
    const typeormWhere: any = {};
    
    for (const [key, value] of Object.entries(where)) {
      if (value === null || value === undefined) {
        typeormWhere[key] = null;
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle complex filters
        if ('gt' in value) {
          typeormWhere[key] = { $gt: value.gt };
        } else if ('gte' in value) {
          typeormWhere[key] = { $gte: value.gte };
        } else if ('lt' in value) {
          typeormWhere[key] = { $lt: value.lt };
        } else if ('lte' in value) {
          typeormWhere[key] = { $lte: value.lte };
        } else if ('like' in value) {
          typeormWhere[key] = { $like: value.like };
        } else if ('in' in value) {
          typeormWhere[key] = { $in: value.in };
        } else {
          typeormWhere[key] = value;
        }
      } else if (Array.isArray(value)) {
        // Handle array filters (in operator)
        typeormWhere[key] = { $in: value };
      } else {
        typeormWhere[key] = value;
      }
    }
    
    return typeormWhere;
  }
  
  protected buildOrderByClause(orderBy: SortOptions | SortOptions[]): any {
    if (Array.isArray(orderBy)) {
      return orderBy.reduce((acc, sort) => {
        acc[sort.field] = sort.direction.toUpperCase();
        return acc;
      }, {} as any);
    }
    
    return {
      [orderBy.field]: orderBy.direction.toUpperCase()
    };
  }
  
  // Advanced TypeORM-specific methods
  
  /**
   * Create a query builder for complex queries
   */
  createQueryBuilder(alias?: string) {
    return this.repository.createQueryBuilder(alias);
  }
  
  /**
   * Execute raw SQL query
   */
  async query(sql: string, parameters?: any[]): Promise<any> {
    return await this.dataSource.manager.query(sql, parameters);
  }
  
  /**
   * Soft delete (if entity supports it)
   */
  async softDelete(id: ID): Promise<boolean> {
    try {
      // Check if entity has deletedAt column
      const metadata = this.dataSource.getMetadata(this.entity);
      const hasDeletedAt = metadata.columns.some((col: any) => col.propertyName === 'deletedAt');
      
      if (hasDeletedAt) {
        const result = await this.repository.update({ id } as any, { deletedAt: new Date() } as any);
        return (result.affected || 0) > 0;
      } else {
        // Fall back to hard delete
        return await this.delete(id);
      }
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Restore soft deleted entity
   */
  async restore(id: ID): Promise<boolean> {
    try {
      const result = await this.repository.update({ id } as any, { deletedAt: null } as any);
      return (result.affected || 0) > 0;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Find with relations
   */
  async findWithRelations(id: ID, relations: string[]): Promise<T | null> {
    const result = await this.repository.findOne({
      where: { id } as any,
      relations
    });
    return result ? this.validate(result) : null;
  }
  
  /**
   * Bulk insert with better performance
   */
  async bulkInsert(data: Partial<T>[]): Promise<void> {
    const validatedData = data.map(item => this.validatePartial(item));
    
    // Use query builder for bulk insert
    const queryBuilder = this.repository.createQueryBuilder();
    const insertBuilder = queryBuilder.insert();
    
    if (insertBuilder) {
      await insertBuilder
        .into(this.entity)
        .values(validatedData)
        .execute();
    } else {
      // Fallback to regular save if insert builder is not available
      await this.createMany(data);
    }
  }
  
  /**
   * Upsert operation (insert or update)
   */
  async upsert(data: Partial<T>, conflictColumns: string[]): Promise<T> {
    const validatedData = this.validatePartial(data);
    
    try {
      // Try to insert first
      const entity = this.repository.create(validatedData);
      const saved = await this.repository.save(entity);
      return this.validate(saved);
    } catch (error) {
      // If conflict, try to update
      const whereClause = conflictColumns.reduce((acc, col) => {
        if (col in validatedData) {
          acc[col] = (validatedData as any)[col];
        }
        return acc;
      }, {} as any);
      
      const existing = await this.repository.findOneBy(whereClause);
      if (existing) {
        const merged = this.repository.merge(existing, validatedData);
        const saved = await this.repository.save(merged);
        return this.validate(saved);
      }
      
      throw error;
    }
  }
}