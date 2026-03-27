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
  /** Number of items actually returned (≤ limit) */
  count: number;
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
  /** Index (1-based) of the first item on this page */
  from: number;
  /** Index (1-based) of the last item on this page */
  to: number;
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
    if (limit <= 0) {
      throw new Error('Limit must be greater than 0');
    }
    const totalPages = Math.ceil(total / limit);
    
    const offset = PaginationHelper.calculateOffset(page, limit);
    return {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      firstPage: 1,
      lastPage: totalPages,
      from: total === 0 ? 0 : offset + 1,
      to:   Math.min(offset + limit, total),
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
   * Parse pagination query params from a raw query object.
   *
   * Unlike `extractPaginationFromQuery`, this method accepts an explicit
   * `defaultLimit` and `maxLimit` and **never throws** — invalid values fall
   * back to the defaults so the endpoint stays resilient.
   *
   * @param query        - Raw query-param object (e.g. `c.req.query()`)
   * @param defaultLimit - Default page size (default: 10)
   * @param maxLimit     - Hard upper bound on `limit` (default: 100)
   */
  static parsePaginationQuery(
    query: Record<string, any>,
    defaultLimit = 10,
    maxLimit = 100,
  ): OffsetPaginationOptions {
    const rawPage  = parseInt(query['page'],  10);
    const rawLimit = parseInt(query['limit'], 10);

    const page  = Number.isFinite(rawPage)  && rawPage  >= 1 ? rawPage  : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, maxLimit)
      : defaultLimit;

    return { page, limit };
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
   * Create cursor paginated result.
   *
   * Pass `fetchedLimit + 1` items from the database; this helper will slice
   * the extra item off and use its presence to determine `hasNext`.
   *
   * @param data          - Items fetched from the DB (up to `limit + 1`)
   * @param limit         - Requested page size
   * @param cursorField   - Field used as the cursor (default: `'id'`)
   * @param hadPrevCursor - Whether the caller passed an incoming cursor,
   *                        which implies there is a previous page
   */
  static createCursorPaginatedResult<T>(
    data: T[],
    limit: number,
    cursorField: string = 'id',
    hadPrevCursor = false,
  ): CursorPaginatedResult<T> {
    const hasNext  = data.length > limit;
    const hasPrev  = hadPrevCursor; // if we arrived here with a cursor, there is a prev page

    // Slice off the look-ahead item
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
      limit,
      count: resultData.length,
    };
  }

  /**
   * Create a multi-field cursor (e.g. `{ createdAt, id }` for stable sorting).
   *
   * @param entity       - Entity to extract cursor values from
   * @param cursorFields - Ordered list of fields to include in the cursor
   *
   * @example
   * ```ts
   * const cursor = CursorPaginationHelper.createMultiCursor(post, ['createdAt', 'id']);
   * // → opaque base-64 string encoding { createdAt: '…', id: '…' }
   * ```
   */
  static createMultiCursor(entity: any, cursorFields: string[]): string {
    const cursorData: Record<string, any> = {};
    for (const field of cursorFields) {
      if (entity[field] === undefined || entity[field] === null) {
        throw new Error(`Cursor field '${field}' is missing from entity`);
      }
      cursorData[field] = entity[field];
    }
    return this.encodeCursor(cursorData);
  }

  /**
   * Decode a multi-field cursor and return the field map.
   *
   * @example
   * ```ts
   * const { createdAt, id } = CursorPaginationHelper.decodeMultiCursor(cursor);
   * ```
   */
  static decodeMultiCursor(cursor: string): Record<string, any> {
    return this.decodeCursor(cursor);
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

// ---------------------------------------------------------------------------
// Standalone convenience helpers
// ---------------------------------------------------------------------------

/**
 * Quick offset-pagination helper — build an enriched paginated response from
 * a raw items array and a total count in one call.
 *
 * @example
 * ```ts
 * const rows  = await db.query('SELECT * FROM products LIMIT ? OFFSET ?', [limit, offset]);
 * const total = (await db.query('SELECT COUNT(*) as n FROM products'))[0].n;
 * return paginate(rows, total, page, limit);
 * ```
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): { data: T[]; meta: PaginationMeta } {
  const meta = PaginationHelper.calculateMeta(total, page, limit);
  return { data, meta };
}

/**
 * Parse cursor-pagination query params (`cursor`, `limit`) from a raw query
 * object.  Falls back gracefully on invalid values.
 *
 * @param query        - Raw query-param object (e.g. `c.req.query()`)
 * @param defaultLimit - Default page size (default: 20)
 * @param maxLimit     - Hard upper bound on `limit` (default: 100)
 */
export function parseCursorQuery(
  query: Record<string, any>,
  defaultLimit = 20,
  maxLimit = 100,
): { cursor?: string; limit: number } {
  const rawLimit = parseInt(query['limit'], 10);
  const limit    = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;

  const cursor = typeof query['cursor'] === 'string' && query['cursor'].length > 0
    ? query['cursor']
    : undefined;

  return { cursor, limit };
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