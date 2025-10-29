import { PaginationOptions, PaginatedResult, FindOptions } from './base-repository';

// Enhanced pagination interfaces
export interface CursorPaginationOptions {
  cursor?: string;
  limit: number;
  direction?: 'forward' | 'backward';
}

export interface CursorPaginatedResult<T> {
  data: T[];
  nextCursor?: string;
  prevCursor?: string;
  hasNext: boolean;
  hasPrev: boolean;
  limit: number;
}

export interface OffsetPaginationOptions extends PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  firstPage: number;
  lastPage: number;
}

/**
 * Pagination utility class
 */
export class PaginationHelper {
  /**
   * Calculate pagination metadata
   */
  static calculateMeta(
    total: number,
    page: number,
    limit: number
  ): PaginationMeta {
    const totalPages = Math.ceil(total / limit);
    
    return {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      firstPage: 1,
      lastPage: totalPages
    };
  }
  
  /**
   * Calculate offset from page and limit
   */
  static calculateOffset(page: number, limit: number): number {
    return (page - 1) * limit;
  }
  
  /**
   * Calculate page from offset and limit
   */
  static calculatePage(offset: number, limit: number): number {
    return Math.floor(offset / limit) + 1;
  }
  
  /**
   * Validate pagination parameters
   */
  static validatePagination(page: number, limit: number): void {
    if (page < 1) {
      throw new Error('Page must be greater than 0');
    }
    
    if (limit < 1) {
      throw new Error('Limit must be greater than 0');
    }
    
    if (limit > 1000) {
      throw new Error('Limit cannot exceed 1000');
    }
  }
  
  /**
   * Create paginated result
   */
  static createPaginatedResult<T>(
    data: T[],
    total: number,
    page: number,
    limit: number
  ): PaginatedResult<T> {
    const meta = this.calculateMeta(total, page, limit);
    
    return {
      data,
      total: meta.total,
      page: meta.page,
      limit: meta.limit,
      totalPages: meta.totalPages,
      hasNext: meta.hasNext,
      hasPrev: meta.hasPrev
    };
  }
  
  /**
   * Extract pagination options from query parameters
   */
  static extractPaginationFromQuery(query: any): OffsetPaginationOptions {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    
    this.validatePagination(page, limit);
    
    return { page, limit };
  }
}

/**
 * Cursor-based pagination helper
 */
export class CursorPaginationHelper {
  /**
   * Encode cursor from object
   */
  static encodeCursor(data: any): string {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }
  
  /**
   * Decode cursor to object
   */
  static decodeCursor(cursor: string): any {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString());
    } catch (error) {
      throw new Error('Invalid cursor format');
    }
  }
  
  /**
   * Create cursor from entity
   */
  static createCursor(entity: any, cursorField: string = 'id'): string {
    const cursorValue = entity[cursorField];
    if (cursorValue === undefined || cursorValue === null) {
      throw new Error(`Cursor field '${cursorField}' not found in entity`);
    }
    
    return this.encodeCursor({ [cursorField]: cursorValue });
  }
  
  /**
   * Extract cursor value
   */
  static extractCursorValue(cursor: string, cursorField: string = 'id'): any {
    const decoded = this.decodeCursor(cursor);
    return decoded[cursorField];
  }
  
  /**
   * Create cursor paginated result
   */
  static createCursorPaginatedResult<T>(
    data: T[],
    limit: number,
    cursorField: string = 'id'
  ): CursorPaginatedResult<T> {
    const hasNext = data.length > limit;
    const hasPrev = false; // This would need to be determined by the query
    
    // Remove extra item if we fetched limit + 1
    const resultData = hasNext ? data.slice(0, limit) : data;
    
    let nextCursor: string | undefined;
    let prevCursor: string | undefined;
    
    if (resultData.length > 0) {
      if (hasNext) {
        nextCursor = this.createCursor(resultData[resultData.length - 1], cursorField);
      }
      
      if (hasPrev) {
        prevCursor = this.createCursor(resultData[0], cursorField);
      }
    }
    
    return {
      data: resultData,
      nextCursor,
      prevCursor,
      hasNext,
      hasPrev,
      limit
    };
  }
}

/**
 * Advanced pagination builder
 */
export class PaginationBuilder<T> {
  private options: Partial<FindOptions> = {};
  
  constructor(private baseQuery: FindOptions = {}) {
    this.options = { ...baseQuery };
  }
  
  /**
   * Set offset-based pagination
   */
  offset(page: number, limit: number): this {
    PaginationHelper.validatePagination(page, limit);
    
    this.options.pagination = {
      page,
      limit,
      offset: PaginationHelper.calculateOffset(page, limit)
    };
    
    return this;
  }
  
  /**
   * Set cursor-based pagination
   */
  cursor(cursor: string, limit: number, cursorField: string = 'id'): this {
    if (limit < 1 || limit > 1000) {
      throw new Error('Limit must be between 1 and 1000');
    }
    
    const cursorValue = CursorPaginationHelper.extractCursorValue(cursor, cursorField);
    
    // Add cursor condition to where clause
    this.options.where = {
      ...this.options.where,
      [cursorField]: { gt: cursorValue }
    };
    
    this.options.pagination = { limit };
    
    return this;
  }
  
  /**
   * Set sorting
   */
  orderBy(field: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
    this.options.orderBy = { field: field as string, direction };
    return this;
  }
  
  /**
   * Add multiple sorting
   */
  orderByMultiple(sorts: Array<{ field: keyof T; direction: 'asc' | 'desc' }>): this {
    this.options.orderBy = sorts.map(sort => ({
      field: sort.field as string,
      direction: sort.direction
    }));
    return this;
  }
  
  /**
   * Add where conditions
   */
  where(conditions: Partial<T>): this {
    this.options.where = { ...this.options.where, ...conditions };
    return this;
  }
  
  /**
   * Add select fields
   */
  select(fields: (keyof T)[]): this {
    this.options.select = fields as string[];
    return this;
  }
  
  /**
   * Add include relations
   */
  include(relations: string[]): this {
    this.options.include = relations;
    return this;
  }
  
  /**
   * Build the final query options
   */
  build(): FindOptions {
    return this.options;
  }
  
  /**
   * Reset the builder
   */
  reset(): this {
    this.options = { ...this.baseQuery };
    return this;
  }
}

/**
 * Pagination decorator for automatic pagination handling
 */
export function Paginated(defaultLimit: number = 10, maxLimit: number = 100) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      // Extract pagination from the last argument if it's an object with page/limit
      const lastArg = args[args.length - 1];
      
      if (lastArg && typeof lastArg === 'object' && ('page' in lastArg || 'limit' in lastArg)) {
        const page = lastArg.page || 1;
        const limit = Math.min(lastArg.limit || defaultLimit, maxLimit);
        
        PaginationHelper.validatePagination(page, limit);
        
        // Update the pagination in the last argument
        lastArg.pagination = {
          page,
          limit,
          offset: PaginationHelper.calculateOffset(page, limit)
        };
      }
      
      return await originalMethod.apply(this, args);
    };
    
    return descriptor;
  };
}

/**
 * Pagination response transformer
 */
export class PaginationTransformer {
  /**
   * Transform paginated result to API response format
   */
  static toApiResponse<T>(result: PaginatedResult<T>, baseUrl?: string): any {
    const response: any = {
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      },
      links: {
        first: baseUrl ? `${baseUrl}?page=1&limit=${result.limit}` : null,
        last: baseUrl ? `${baseUrl}?page=${result.totalPages}&limit=${result.limit}` : null,
        prev: result.hasPrev && baseUrl ? `${baseUrl}?page=${result.page - 1}&limit=${result.limit}` : null,
        next: result.hasNext && baseUrl ? `${baseUrl}?page=${result.page + 1}&limit=${result.limit}` : null
      }
    };
    
    return response;
  }
  
  /**
   * Transform cursor paginated result to API response format
   */
  static toCursorApiResponse<T>(result: CursorPaginatedResult<T>, baseUrl?: string): any {
    const response: any = {
      data: result.data,
      meta: {
        limit: result.limit,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev
      },
      cursors: {
        next: result.nextCursor,
        prev: result.prevCursor
      }
    };
    
    if (baseUrl) {
      response.links = {
        next: result.nextCursor ? `${baseUrl}?cursor=${result.nextCursor}&limit=${result.limit}` : null,
        prev: result.prevCursor ? `${baseUrl}?cursor=${result.prevCursor}&limit=${result.limit}` : null
      };
    }
    
    return response;
  }
}