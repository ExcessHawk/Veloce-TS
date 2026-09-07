import { z } from 'zod';
import { NotImplementedError } from './errors.js';

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
    return Promise.all(data.map(item => this.create(item)));
  }
  
  /**
   * ORM adapters MUST override this with a native bulk UPDATE.
   * There is intentionally no default: the previous fallback fetched every
   * matching row and updated them one by one (a silent full scan + N queries).
   */
  async updateMany(_where: FilterOptions, _data: Partial<T>): Promise<number> {
    throw new NotImplementedError('updateMany()');
  }

  /**
   * ORM adapters MUST override this with a native bulk DELETE.
   * There is intentionally no default: the previous fallback fetched every
   * matching row and deleted them one by one (a silent full scan + N queries).
   */
  async deleteMany(_where: FilterOptions): Promise<number> {
    throw new NotImplementedError('deleteMany()');
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
  
  /**
   * ORM adapters MUST override this with a native COUNT query.
   * There is intentionally no default: the previous fallback loaded every
   * matching row into memory just to measure the array length.
   * Note: the default findPaginated() implementation relies on count(),
   * so a custom repository must override count() to use pagination.
   */
  async count(_where?: FilterOptions): Promise<number> {
    throw new NotImplementedError('count()');
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