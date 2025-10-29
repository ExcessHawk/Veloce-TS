import { z } from 'zod';
import { BaseRepository, FindOptions, FilterOptions, SortOptions, PaginationOptions, PaginatedResult } from '../base-repository';
import { PrismaRepositoryOptions, PrismaDelegate, PrismaClientLike } from './types';

/**
 * Prisma-specific repository implementation
 */
export class PrismaRepository<T, ID = string | number> extends BaseRepository<T, ID> {
  protected client: PrismaClientLike;
  protected delegate: PrismaDelegate;
  protected modelName: string;
  
  constructor(options: PrismaRepositoryOptions) {
    super(options.zodSchema);
    this.client = options.client;
    this.delegate = options.delegate;
    this.modelName = options.model;
  }
  
  async create(data: Partial<T>): Promise<T> {
    const validatedData = this.validatePartial(data);
    const result = await this.delegate.create({
      data: validatedData
    });
    return this.validate(result);
  }
  
  async findById(id: ID): Promise<T | null> {
    const result = await this.delegate.findUnique({
      where: { id }
    });
    return result ? this.validate(result) : null;
  }
  
  async findOne(options: FindOptions): Promise<T | null> {
    const prismaOptions = this.buildPrismaFindOptions(options);
    const result = await this.delegate.findFirst(prismaOptions);
    return result ? this.validate(result) : null;
  }
  
  async findMany(options?: FindOptions): Promise<T[]> {
    const prismaOptions = this.buildPrismaFindOptions(options || {});
    const results = await this.delegate.findMany(prismaOptions);
    return results.map(result => this.validate(result));
  }
  
  async update(id: ID, data: Partial<T>): Promise<T> {
    const validatedData = this.validatePartial(data);
    const result = await this.delegate.update({
      where: { id },
      data: validatedData
    });
    return this.validate(result);
  }
  
  async delete(id: ID): Promise<boolean> {
    try {
      await this.delegate.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      // Handle not found error
      return false;
    }
  }
  
  // Optimized bulk operations using Prisma's native methods
  async createMany(data: Partial<T>[]): Promise<T[]> {
    const validatedData = data.map(item => this.validatePartial(item));
    
    // Use Prisma's createMany for better performance
    await this.delegate.create({
      data: validatedData,
      skipDuplicates: true
    });
    
    // Note: Prisma's createMany doesn't return created records
    // For now, we'll fall back to individual creates if we need the results
    const results: T[] = [];
    for (const item of validatedData) {
      const created = await this.create(item);
      results.push(created);
    }
    
    return results;
  }
  
  async updateMany(where: FilterOptions, data: Partial<T>): Promise<number> {
    const validatedData = this.validatePartial(data);
    const result = await this.delegate.updateMany({
      where: this.buildWhereClause(where),
      data: validatedData
    });
    return result.count;
  }
  
  async deleteMany(where: FilterOptions): Promise<number> {
    const result = await this.delegate.deleteMany({
      where: this.buildWhereClause(where)
    });
    return result.count;
  }
  
  async count(where?: FilterOptions): Promise<number> {
    return await this.delegate.count({
      where: where ? this.buildWhereClause(where) : undefined
    });
  }
  
  async exists(where: FilterOptions): Promise<boolean> {
    const count = await this.delegate.count({
      where: this.buildWhereClause(where),
      take: 1
    });
    return count > 0;
  }
  
  // Optimized pagination using Prisma's native pagination
  async findPaginated(options: FindOptions & { pagination: Required<PaginationOptions> }): Promise<PaginatedResult<T>> {
    const { pagination, ...findOptions } = options;
    const { page, limit } = pagination;
    
    // Calculate skip
    const skip = (page - 1) * limit;
    
    // Build Prisma options
    const prismaOptions = this.buildPrismaFindOptions(findOptions);
    
    // Get total count and data in parallel
    const [total, data] = await Promise.all([
      this.delegate.count({ where: prismaOptions.where }),
      this.delegate.findMany({
        ...prismaOptions,
        skip,
        take: limit
      })
    ]);
    
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
  
  // Transaction support using Prisma's transaction API
  async withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return await this.client.$transaction(async (prismaClient) => {
      // Create a new repository instance with the transaction client
      const transactionalRepo = new (this.constructor as any)({
        client: prismaClient,
        delegate: (prismaClient as any)[this.modelName.toLowerCase()],
        model: this.modelName,
        zodSchema: this.schema
      });
      
      return await callback(transactionalRepo as this);
    });
  }
  
  // Build Prisma-specific find options
  private buildPrismaFindOptions(options: FindOptions): any {
    const prismaOptions: any = {};
    
    if (options.where) {
      prismaOptions.where = this.buildWhereClause(options.where);
    }
    
    if (options.orderBy) {
      prismaOptions.orderBy = this.buildOrderByClause(options.orderBy);
    }
    
    if (options.pagination) {
      const paginationClause = this.buildPaginationClause(options.pagination);
      Object.assign(prismaOptions, paginationClause);
    }
    
    if (options.include) {
      prismaOptions.include = options.include.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {} as any);
    }
    
    if (options.select) {
      prismaOptions.select = options.select.reduce((acc, field) => {
        acc[field] = true;
        return acc;
      }, {} as any);
    }
    
    return prismaOptions;
  }
  
  // Override base class methods for Prisma-specific implementations
  protected buildWhereClause(where: FilterOptions): any {
    const prismaWhere: any = {};
    
    for (const [key, value] of Object.entries(where)) {
      if (value === null || value === undefined) {
        prismaWhere[key] = null;
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle complex filters like { gt: 10 }, { contains: 'text' }
        prismaWhere[key] = value;
      } else if (Array.isArray(value)) {
        // Handle array filters (in operator)
        prismaWhere[key] = { in: value };
      } else {
        prismaWhere[key] = value;
      }
    }
    
    return prismaWhere;
  }
  
  protected buildOrderByClause(orderBy: SortOptions | SortOptions[]): any {
    if (Array.isArray(orderBy)) {
      return orderBy.map(sort => ({
        [sort.field]: sort.direction
      }));
    }
    
    return {
      [orderBy.field]: orderBy.direction
    };
  }
  
  protected buildPaginationClause(pagination: PaginationOptions): any {
    const result: any = {};
    
    if (pagination.limit) {
      result.take = pagination.limit;
    }
    
    if (pagination.offset) {
      result.skip = pagination.offset;
    }
    
    return result;
  }
  
  // Advanced Prisma-specific methods
  async aggregate(options: {
    where?: FilterOptions;
    _count?: boolean | { [key: string]: boolean };
    _avg?: { [key: string]: boolean };
    _sum?: { [key: string]: boolean };
    _min?: { [key: string]: boolean };
    _max?: { [key: string]: boolean };
  }): Promise<any> {
    const prismaOptions: any = {};
    
    if (options.where) {
      prismaOptions.where = this.buildWhereClause(options.where);
    }
    
    if (options._count) {
      prismaOptions._count = options._count;
    }
    
    if (options._avg) {
      prismaOptions._avg = options._avg;
    }
    
    if (options._sum) {
      prismaOptions._sum = options._sum;
    }
    
    if (options._min) {
      prismaOptions._min = options._min;
    }
    
    if (options._max) {
      prismaOptions._max = options._max;
    }
    
    return await this.delegate.aggregate(prismaOptions);
  }
  
  async groupBy(options: {
    by: string[];
    where?: FilterOptions;
    having?: FilterOptions;
    orderBy?: SortOptions | SortOptions[];
    _count?: boolean | { [key: string]: boolean };
    _avg?: { [key: string]: boolean };
    _sum?: { [key: string]: boolean };
    _min?: { [key: string]: boolean };
    _max?: { [key: string]: boolean };
  }): Promise<any[]> {
    const prismaOptions: any = {
      by: options.by
    };
    
    if (options.where) {
      prismaOptions.where = this.buildWhereClause(options.where);
    }
    
    if (options.having) {
      prismaOptions.having = this.buildWhereClause(options.having);
    }
    
    if (options.orderBy) {
      prismaOptions.orderBy = this.buildOrderByClause(options.orderBy);
    }
    
    if (options._count) {
      prismaOptions._count = options._count;
    }
    
    if (options._avg) {
      prismaOptions._avg = options._avg;
    }
    
    if (options._sum) {
      prismaOptions._sum = options._sum;
    }
    
    if (options._min) {
      prismaOptions._min = options._min;
    }
    
    if (options._max) {
      prismaOptions._max = options._max;
    }
    
    return await this.delegate.groupBy(prismaOptions);
  }
}