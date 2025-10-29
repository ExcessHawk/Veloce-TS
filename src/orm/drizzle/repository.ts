import { z } from 'zod';
import { BaseRepository, FindOptions, FilterOptions, SortOptions, PaginationOptions, PaginatedResult } from '../base-repository';
import { DrizzleRepositoryOptions, DrizzleDatabase, DrizzleTable, DrizzleOperators } from './types';

/**
 * Drizzle-specific repository implementation
 */
export class DrizzleRepository<T, ID = string | number> extends BaseRepository<T, ID> {
  protected database: DrizzleDatabase;
  protected table: DrizzleTable;
  protected operators: DrizzleOperators;
  
  constructor(options: DrizzleRepositoryOptions<T>) {
    super(options.zodSchema);
    this.database = options.database;
    this.table = options.table;
    
    // Initialize operators (these would be imported from drizzle-orm)
    this.operators = this.initializeOperators();
  }
  
  private initializeOperators(): DrizzleOperators {
    // In a real implementation, these would be imported from drizzle-orm
    // For now, we'll create placeholder implementations
    return {
      eq: (column: any, value: any) => ({ type: 'eq', column, value }),
      ne: (column: any, value: any) => ({ type: 'ne', column, value }),
      gt: (column: any, value: any) => ({ type: 'gt', column, value }),
      gte: (column: any, value: any) => ({ type: 'gte', column, value }),
      lt: (column: any, value: any) => ({ type: 'lt', column, value }),
      lte: (column: any, value: any) => ({ type: 'lte', column, value }),
      like: (column: any, value: string) => ({ type: 'like', column, value }),
      ilike: (column: any, value: string) => ({ type: 'ilike', column, value }),
      inArray: (column: any, values: any[]) => ({ type: 'in', column, values }),
      notInArray: (column: any, values: any[]) => ({ type: 'notIn', column, values }),
      isNull: (column: any) => ({ type: 'isNull', column }),
      isNotNull: (column: any) => ({ type: 'isNotNull', column }),
      between: (column: any, min: any, max: any) => ({ type: 'between', column, min, max }),
      and: (...conditions: any[]) => ({ type: 'and', conditions }),
      or: (...conditions: any[]) => ({ type: 'or', conditions }),
      not: (condition: any) => ({ type: 'not', condition })
    };
  }
  
  async create(data: Partial<T>): Promise<T> {
    const validatedData = this.validatePartial(data);
    
    const result = await this.database
      .insert(this.table)
      .values(validatedData)
      .returning()
      .execute();
    
    return this.validate(result[0]);
  }
  
  async findById(id: ID): Promise<T | null> {
    const idColumn = this.getPrimaryKeyColumn();
    
    const result = await this.database
      .select()
      .from(this.table)
      .where(this.operators.eq(idColumn, id))
      .execute();
    
    return result.length > 0 ? this.validate(result[0]) : null;
  }
  
  async findOne(options: FindOptions): Promise<T | null> {
    let query = this.database.select().from(this.table);
    
    if (options.where) {
      query = query.where(this.buildWhereClause(options.where));
    }
    
    if (options.orderBy) {
      query = query.orderBy(...this.buildOrderByClause(options.orderBy));
    }
    
    query = query.limit(1);
    
    const result = await query.execute();
    return result.length > 0 ? this.validate(result[0]) : null;
  }
  
  async findMany(options?: FindOptions): Promise<T[]> {
    let query = this.database.select().from(this.table);
    
    if (options?.where) {
      query = query.where(this.buildWhereClause(options.where));
    }
    
    if (options?.orderBy) {
      query = query.orderBy(...this.buildOrderByClause(options.orderBy));
    }
    
    if (options?.pagination) {
      if (options.pagination.limit) {
        query = query.limit(options.pagination.limit);
      }
      if (options.pagination.offset) {
        query = query.offset(options.pagination.offset);
      }
    }
    
    const results = await query.execute();
    return results.map((result: any) => this.validate(result));
  }
  
  async update(id: ID, data: Partial<T>): Promise<T> {
    const validatedData = this.validatePartial(data);
    const idColumn = this.getPrimaryKeyColumn();
    
    const result = await this.database
      .update(this.table)
      .set(validatedData)
      .where(this.operators.eq(idColumn, id))
      .returning()
      .execute();
    
    if (result.length === 0) {
      throw new Error(`Entity with id ${id} not found`);
    }
    
    return this.validate(result[0]);
  }
  
  async delete(id: ID): Promise<boolean> {
    const idColumn = this.getPrimaryKeyColumn();
    
    const result = await this.database
      .delete(this.table)
      .where(this.operators.eq(idColumn, id))
      .execute();
    
    return result.rowsAffected > 0;
  }
  
  // Optimized bulk operations using Drizzle's native methods
  async createMany(data: Partial<T>[]): Promise<T[]> {
    const validatedData = data.map((item: Partial<T>) => this.validatePartial(item));
    
    const result = await this.database
      .insert(this.table)
      .values(validatedData)
      .returning()
      .execute();
    
    return result.map((item: any) => this.validate(item));
  }
  
  async updateMany(where: FilterOptions, data: Partial<T>): Promise<number> {
    const validatedData = this.validatePartial(data);
    const whereClause = this.buildWhereClause(where);
    
    const result = await this.database
      .update(this.table)
      .set(validatedData)
      .where(whereClause)
      .execute();
    
    return result.rowsAffected;
  }
  
  async deleteMany(where: FilterOptions): Promise<number> {
    const whereClause = this.buildWhereClause(where);
    
    const result = await this.database
      .delete(this.table)
      .where(whereClause)
      .execute();
    
    return result.rowsAffected;
  }
  
  async count(where?: FilterOptions): Promise<number> {
    let query = this.database.select({ count: 'COUNT(*)' }).from(this.table);
    
    if (where) {
      query = query.where(this.buildWhereClause(where));
    }
    
    const result = await query.execute();
    return result[0]?.count || 0;
  }
  
  async exists(where: FilterOptions): Promise<boolean> {
    const count = await this.count(where);
    return count > 0;
  }
  
  // Optimized pagination using Drizzle's native pagination
  async findPaginated(options: FindOptions & { pagination: Required<PaginationOptions> }): Promise<PaginatedResult<T>> {
    const { pagination, ...findOptions } = options;
    const { page, limit } = pagination;
    
    // Calculate offset
    const offset = (page - 1) * limit;
    
    // Build base query
    let dataQuery = this.database.select().from(this.table);
    let countQuery = this.database.select({ count: 'COUNT(*)' }).from(this.table);
    
    if (findOptions.where) {
      const whereClause = this.buildWhereClause(findOptions.where);
      dataQuery = dataQuery.where(whereClause);
      countQuery = countQuery.where(whereClause);
    }
    
    if (findOptions.orderBy) {
      dataQuery = dataQuery.orderBy(...this.buildOrderByClause(findOptions.orderBy));
    }
    
    dataQuery = dataQuery.limit(limit).offset(offset);
    
    // Execute both queries in parallel
    const [data, countResult] = await Promise.all([
      dataQuery.execute(),
      countQuery.execute()
    ]);
    
    const total = countResult[0]?.count || 0;
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
  
  // Transaction support using Drizzle's transaction API
  async withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return await this.database.transaction(async (tx) => {
      // Create a new repository instance with the transaction database
      const transactionalRepo = new (this.constructor as any)({
        database: tx,
        table: this.table,
        zodSchema: this.schema
      });
      
      return await callback(transactionalRepo as this);
    });
  }
  
  // Build Drizzle-specific where clause
  protected buildWhereClause(where: FilterOptions): any {
    const conditions: any[] = [];
    
    for (const [key, value] of Object.entries(where)) {
      const column = this.getColumn(key);
      
      if (value === null || value === undefined) {
        conditions.push(this.operators.isNull(column));
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle complex filters
        if ('gt' in value) {
          conditions.push(this.operators.gt(column, value.gt));
        } else if ('gte' in value) {
          conditions.push(this.operators.gte(column, value.gte));
        } else if ('lt' in value) {
          conditions.push(this.operators.lt(column, value.lt));
        } else if ('lte' in value) {
          conditions.push(this.operators.lte(column, value.lte));
        } else if ('like' in value) {
          conditions.push(this.operators.like(column, value.like));
        } else if ('ilike' in value) {
          conditions.push(this.operators.ilike(column, value.ilike));
        } else if ('in' in value) {
          conditions.push(this.operators.inArray(column, value.in));
        } else if ('notIn' in value) {
          conditions.push(this.operators.notInArray(column, value.notIn));
        } else if ('between' in value && Array.isArray(value.between) && value.between.length === 2) {
          conditions.push(this.operators.between(column, value.between[0], value.between[1]));
        } else {
          conditions.push(this.operators.eq(column, value));
        }
      } else if (Array.isArray(value)) {
        // Handle array filters (in operator)
        conditions.push(this.operators.inArray(column, value));
      } else {
        conditions.push(this.operators.eq(column, value));
      }
    }
    
    return conditions.length === 1 ? conditions[0] : this.operators.and(...conditions);
  }
  
  // Build Drizzle-specific order by clause
  protected buildOrderByClause(orderBy: SortOptions | SortOptions[]): any[] {
    if (Array.isArray(orderBy)) {
      return orderBy.map(sort => {
        const column = this.getColumn(sort.field);
        return sort.direction === 'desc' ? { column, direction: 'desc' } : column;
      });
    }
    
    const column = this.getColumn(orderBy.field);
    return orderBy.direction === 'desc' ? [{ column, direction: 'desc' }] : [column];
  }
  
  // Helper methods
  private getPrimaryKeyColumn(): any {
    // Find the primary key column
    for (const [columnName, column] of Object.entries(this.table._.columns)) {
      if (column._.isPrimaryKey) {
        return (this.table as any)[columnName];
      }
    }
    
    // Default to 'id' if no primary key found
    return (this.table as any).id || this.table._.columns.id;
  }
  
  private getColumn(name: string): any {
    return (this.table as any)[name] || this.table._.columns[name];
  }
  
  // Advanced Drizzle-specific methods
  
  /**
   * Execute raw SQL query
   */
  async rawQuery(sql: string, params?: any[]): Promise<any[]> {
    // This would depend on the specific Drizzle database implementation
    return await this.database.execute({ sql, params });
  }
  
  /**
   * Upsert operation (insert or update on conflict)
   */
  async upsert(data: Partial<T>, conflictColumns: string[]): Promise<T> {
    const validatedData = this.validatePartial(data);
    
    // Build conflict target
    const conflictTarget = conflictColumns.map(col => this.getColumn(col));
    
    const result = await this.database
      .insert(this.table)
      .values(validatedData)
      .onConflictDoUpdate({
        target: conflictTarget,
        set: validatedData
      })
      .returning()
      .execute();
    
    return this.validate(result[0]);
  }
  
  /**
   * Bulk upsert operation
   */
  async bulkUpsert(data: Partial<T>[], conflictColumns: string[]): Promise<T[]> {
    const validatedData = data.map((item: Partial<T>) => this.validatePartial(item));
    
    // Build conflict target
    const conflictTarget = conflictColumns.map(col => this.getColumn(col));
    
    const result = await this.database
      .insert(this.table)
      .values(validatedData)
      .onConflictDoUpdate({
        target: conflictTarget,
        set: validatedData[0] // This would need to be more sophisticated in a real implementation
      })
      .returning()
      .execute();
    
    return result.map((item: any) => this.validate(item));
  }
  
  /**
   * Find with custom select fields
   */
  async findWithSelect<K extends keyof T>(
    options: FindOptions,
    select: K[]
  ): Promise<Pick<T, K>[]> {
    const selectFields = select.reduce((acc, field) => {
      acc[field as string] = this.getColumn(field as string);
      return acc;
    }, {} as any);
    
    let query = this.database.select(selectFields).from(this.table);
    
    if (options.where) {
      query = query.where(this.buildWhereClause(options.where));
    }
    
    if (options.orderBy) {
      query = query.orderBy(...this.buildOrderByClause(options.orderBy));
    }
    
    if (options.pagination) {
      if (options.pagination.limit) {
        query = query.limit(options.pagination.limit);
      }
      if (options.pagination.offset) {
        query = query.offset(options.pagination.offset);
      }
    }
    
    return await query.execute();
  }
  
  /**
   * Aggregate operations
   */
  async aggregate(options: {
    where?: FilterOptions;
    groupBy?: string[];
    having?: FilterOptions;
    count?: boolean;
    sum?: string[];
    avg?: string[];
    min?: string[];
    max?: string[];
  }): Promise<any[]> {
    const selectFields: any = {};
    
    if (options.count) {
      selectFields.count = 'COUNT(*)';
    }
    
    if (options.sum) {
      for (const field of options.sum) {
        selectFields[`sum_${field}`] = `SUM(${field})`;
      }
    }
    
    if (options.avg) {
      for (const field of options.avg) {
        selectFields[`avg_${field}`] = `AVG(${field})`;
      }
    }
    
    if (options.min) {
      for (const field of options.min) {
        selectFields[`min_${field}`] = `MIN(${field})`;
      }
    }
    
    if (options.max) {
      for (const field of options.max) {
        selectFields[`max_${field}`] = `MAX(${field})`;
      }
    }
    
    let query = this.database.select(selectFields).from(this.table);
    
    if (options.where) {
      query = query.where(this.buildWhereClause(options.where));
    }
    
    if (options.groupBy) {
      const groupByColumns = options.groupBy.map(field => this.getColumn(field));
      query = query.groupBy(...groupByColumns);
    }
    
    if (options.having) {
      query = query.having(this.buildWhereClause(options.having));
    }
    
    return await query.execute();
  }
}