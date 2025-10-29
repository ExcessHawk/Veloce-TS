import { z } from 'zod';

// Base interfaces for repository pattern
export interface PaginationOptions {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

export interface FilterOptions {
  [key: string]: any;
}

export interface FindOptions {
  where?: FilterOptions;
  orderBy?: SortOptions | SortOptions[];
  pagination?: PaginationOptions;
  include?: string[];
  select?: string[];
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Base repository interface with common CRUD operations
 */
export interface IBaseRepository<T, ID = string | number> {
  // Basic CRUD
  create(data: Partial<T>): Promise<T>;
  findById(id: ID): Promise<T | null>;
  findOne(options: FindOptions): Promise<T | null>;
  findMany(options?: FindOptions): Promise<T[]>;
  update(id: ID, data: Partial<T>): Promise<T>;
  delete(id: ID): Promise<boolean>;
  
  // Bulk operations
  createMany(data: Partial<T>[]): Promise<T[]>;
  updateMany(where: FilterOptions, data: Partial<T>): Promise<number>;
  deleteMany(where: FilterOptions): Promise<number>;
  
  // Pagination and filtering
  findPaginated(options: FindOptions & { pagination: Required<PaginationOptions> }): Promise<PaginatedResult<T>>;
  count(where?: FilterOptions): Promise<number>;
  exists(where: FilterOptions): Promise<boolean>;
  
  // Transaction support
  withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R>;
}

/**
 * Abstract base repository implementation
 */
export abstract class BaseRepository<T, ID = string | number> implements IBaseRepository<T, ID> {
  protected schema?: z.ZodSchema<T>;
  
  constructor(schema?: z.ZodSchema<T>) {
    this.schema = schema;
  }
  
  // Validation helper
  protected validate(data: any): T {
    if (this.schema) {
      return this.schema.parse(data);
    }
    return data as T;
  }
  
  protected validatePartial(data: any): Partial<T> {
    if (this.schema) {
      try {
        // Try to validate with the full schema first
        return this.schema.parse(data);
      } catch {
        // If validation fails, return as partial without validation
        // In a real implementation, you might want to create a partial schema
        return data as Partial<T>;
      }
    }
    return data as Partial<T>;
  }
  
  // Abstract methods to be implemented by concrete repositories
  abstract create(data: Partial<T>): Promise<T>;
  abstract findById(id: ID): Promise<T | null>;
  abstract findOne(options: FindOptions): Promise<T | null>;
  abstract findMany(options?: FindOptions): Promise<T[]>;
  abstract update(id: ID, data: Partial<T>): Promise<T>;
  abstract delete(id: ID): Promise<boolean>;
  
  // Default implementations for bulk operations
  async createMany(data: Partial<T>[]): Promise<T[]> {
    const results: T[] = [];
    for (const item of data) {
      results.push(await this.create(item));
    }
    return results;
  }
  
  async updateMany(where: FilterOptions, data: Partial<T>): Promise<number> {
    const items = await this.findMany({ where });
    let updated = 0;
    
    for (const item of items) {
      const id = (item as any).id;
      if (id) {
        await this.update(id, data);
        updated++;
      }
    }
    
    return updated;
  }
  
  async deleteMany(where: FilterOptions): Promise<number> {
    const items = await this.findMany({ where });
    let deleted = 0;
    
    for (const item of items) {
      const id = (item as any).id;
      if (id && await this.delete(id)) {
        deleted++;
      }
    }
    
    return deleted;
  }
  
  // Default pagination implementation
  async findPaginated(options: FindOptions & { pagination: Required<PaginationOptions> }): Promise<PaginatedResult<T>> {
    const { pagination, ...findOptions } = options;
    const { page, limit } = pagination;
    
    // Calculate offset
    const offset = (page - 1) * limit;
    
    // Get total count
    const total = await this.count(findOptions.where);
    
    // Get paginated data
    const data = await this.findMany({
      ...findOptions,
      pagination: { ...pagination, offset }
    });
    
    const totalPages = Math.ceil(total / limit);
    
    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    };
  }
  
  // Default count implementation
  async count(where?: FilterOptions): Promise<number> {
    const items = await this.findMany({ where });
    return items.length;
  }
  
  // Default exists implementation
  async exists(where: FilterOptions): Promise<boolean> {
    const item = await this.findOne({ where });
    return item !== null;
  }
  
  // Default transaction implementation (to be overridden by ORM-specific implementations)
  async withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    // Default implementation without actual transaction support
    return callback(this);
  }
  
  // Helper methods for building queries
  protected buildWhereClause(where?: FilterOptions): any {
    if (!where) return {};
    
    // Basic implementation - can be overridden by specific ORM implementations
    return where;
  }
  
  protected buildOrderByClause(orderBy?: SortOptions | SortOptions[]): any {
    if (!orderBy) return {};
    
    if (Array.isArray(orderBy)) {
      return orderBy.reduce((acc, sort) => {
        acc[sort.field] = sort.direction;
        return acc;
      }, {} as any);
    }
    
    return { [orderBy.field]: orderBy.direction };
  }
  
  protected buildPaginationClause(pagination?: PaginationOptions): any {
    if (!pagination) return {};
    
    const result: any = {};
    
    if (pagination.limit) {
      result.take = pagination.limit;
    }
    
    if (pagination.offset) {
      result.skip = pagination.offset;
    }
    
    return result;
  }
}