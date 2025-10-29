import { FilterOptions, SortOptions, PaginationOptions } from './base-repository';

// Query builder interfaces
export interface IQueryBuilder<T> {
  select(fields?: (keyof T)[]): this;
  where(conditions: FilterOptions): this;
  orderBy(sort: SortOptions | SortOptions[]): this;
  limit(count: number): this;
  offset(count: number): this;
  groupBy(fields: (keyof T)[]): this;
  having(conditions: FilterOptions): this;
  join(table: string, condition: string): this;
  leftJoin(table: string, condition: string): this;
  rightJoin(table: string, condition: string): this;
  innerJoin(table: string, condition: string): this;
  execute(): Promise<T[]>;
  first(): Promise<T | null>;
  count(): Promise<number>;
  exists(): Promise<boolean>;
}

// Query operators
export interface QueryOperators {
  eq(value: any): FilterCondition;
  ne(value: any): FilterCondition;
  gt(value: any): FilterCondition;
  gte(value: any): FilterCondition;
  lt(value: any): FilterCondition;
  lte(value: any): FilterCondition;
  like(pattern: string): FilterCondition;
  ilike(pattern: string): FilterCondition;
  in(values: any[]): FilterCondition;
  notIn(values: any[]): FilterCondition;
  between(min: any, max: any): FilterCondition;
  isNull(): FilterCondition;
  isNotNull(): FilterCondition;
  and(...conditions: FilterCondition[]): FilterCondition;
  or(...conditions: FilterCondition[]): FilterCondition;
  not(condition: FilterCondition): FilterCondition;
}

// Filter condition interface
export interface FilterCondition {
  type: string;
  field?: string;
  value?: any;
  values?: any[];
  min?: any;
  max?: any;
  pattern?: string;
  conditions?: FilterCondition[];
  condition?: FilterCondition;
}

/**
 * Generic query builder implementation
 */
export class QueryBuilder<T> implements IQueryBuilder<T> {
  private selectFields?: (keyof T)[];
  private whereConditions: FilterCondition[] = [];
  private orderByClause?: SortOptions | SortOptions[];
  private limitCount?: number;
  private offsetCount?: number;
  private groupByFields?: (keyof T)[];
  private havingConditions: FilterCondition[] = [];
  private joins: JoinClause[] = [];
  
  constructor(
    private executor: QueryExecutor<T>,
    private operators: QueryOperators = new DefaultQueryOperators()
  ) {}
  
  select(fields?: (keyof T)[]): this {
    this.selectFields = fields;
    return this;
  }
  
  where(conditions: FilterOptions): this {
    const condition = this.buildFilterCondition(conditions);
    this.whereConditions.push(condition);
    return this;
  }
  
  orderBy(sort: SortOptions | SortOptions[]): this {
    this.orderByClause = sort;
    return this;
  }
  
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }
  
  groupBy(fields: (keyof T)[]): this {
    this.groupByFields = fields;
    return this;
  }
  
  having(conditions: FilterOptions): this {
    const condition = this.buildFilterCondition(conditions);
    this.havingConditions.push(condition);
    return this;
  }
  
  join(table: string, condition: string): this {
    this.joins.push({ type: 'JOIN', table, condition });
    return this;
  }
  
  leftJoin(table: string, condition: string): this {
    this.joins.push({ type: 'LEFT JOIN', table, condition });
    return this;
  }
  
  rightJoin(table: string, condition: string): this {
    this.joins.push({ type: 'RIGHT JOIN', table, condition });
    return this;
  }
  
  innerJoin(table: string, condition: string): this {
    this.joins.push({ type: 'INNER JOIN', table, condition });
    return this;
  }
  
  async execute(): Promise<T[]> {
    const query = this.buildQuery();
    return await this.executor.execute(query);
  }
  
  async first(): Promise<T | null> {
    const originalLimit = this.limitCount;
    this.limit(1);
    
    const results = await this.execute();
    
    // Restore original limit
    this.limitCount = originalLimit;
    
    return results.length > 0 ? results[0] : null;
  }
  
  async count(): Promise<number> {
    const query = this.buildCountQuery();
    return await this.executor.count(query);
  }
  
  async exists(): Promise<boolean> {
    const count = await this.count();
    return count > 0;
  }
  
  // Helper methods
  private buildFilterCondition(conditions: FilterOptions): FilterCondition {
    const filterConditions: FilterCondition[] = [];
    
    for (const [field, value] of Object.entries(conditions)) {
      if (value === null || value === undefined) {
        filterConditions.push({ type: 'isNull', field });
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle complex conditions
        for (const [operator, operatorValue] of Object.entries(value)) {
          switch (operator) {
            case 'eq':
              filterConditions.push({ type: 'eq', field, value: operatorValue });
              break;
            case 'ne':
              filterConditions.push({ type: 'ne', field, value: operatorValue });
              break;
            case 'gt':
              filterConditions.push({ type: 'gt', field, value: operatorValue });
              break;
            case 'gte':
              filterConditions.push({ type: 'gte', field, value: operatorValue });
              break;
            case 'lt':
              filterConditions.push({ type: 'lt', field, value: operatorValue });
              break;
            case 'lte':
              filterConditions.push({ type: 'lte', field, value: operatorValue });
              break;
            case 'like':
              filterConditions.push({ type: 'like', field, pattern: operatorValue as string });
              break;
            case 'ilike':
              filterConditions.push({ type: 'ilike', field, pattern: operatorValue as string });
              break;
            case 'in':
              filterConditions.push({ type: 'in', field, values: operatorValue as any[] });
              break;
            case 'notIn':
              filterConditions.push({ type: 'notIn', field, values: operatorValue as any[] });
              break;
            case 'between':
              if (Array.isArray(operatorValue) && operatorValue.length === 2) {
                filterConditions.push({ 
                  type: 'between', 
                  field, 
                  min: operatorValue[0], 
                  max: operatorValue[1] 
                });
              }
              break;
          }
        }
      } else if (Array.isArray(value)) {
        filterConditions.push({ type: 'in', field, values: value });
      } else {
        filterConditions.push({ type: 'eq', field, value });
      }
    }
    
    return filterConditions.length === 1 
      ? filterConditions[0] 
      : { type: 'and', conditions: filterConditions };
  }
  
  private buildQuery(): QueryDefinition {
    return {
      select: this.selectFields,
      where: this.whereConditions.length > 0 
        ? (this.whereConditions.length === 1 
          ? this.whereConditions[0] 
          : { type: 'and', conditions: this.whereConditions })
        : undefined,
      orderBy: this.orderByClause,
      limit: this.limitCount,
      offset: this.offsetCount,
      groupBy: this.groupByFields,
      having: this.havingConditions.length > 0 
        ? (this.havingConditions.length === 1 
          ? this.havingConditions[0] 
          : { type: 'and', conditions: this.havingConditions })
        : undefined,
      joins: this.joins
    };
  }
  
  private buildCountQuery(): QueryDefinition {
    return {
      select: ['COUNT(*) as count'] as any,
      where: this.whereConditions.length > 0 
        ? (this.whereConditions.length === 1 
          ? this.whereConditions[0] 
          : { type: 'and', conditions: this.whereConditions })
        : undefined,
      joins: this.joins
    };
  }
}

// Query definition interface
export interface QueryDefinition {
  select?: (keyof any)[] | string[];
  where?: FilterCondition;
  orderBy?: SortOptions | SortOptions[];
  limit?: number;
  offset?: number;
  groupBy?: (keyof any)[];
  having?: FilterCondition;
  joins?: JoinClause[];
}

// Join clause interface
export interface JoinClause {
  type: 'JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'INNER JOIN';
  table: string;
  condition: string;
}

// Query executor interface
export interface QueryExecutor<T> {
  execute(query: QueryDefinition): Promise<T[]>;
  count(query: QueryDefinition): Promise<number>;
}

/**
 * Default query operators implementation
 */
export class DefaultQueryOperators implements QueryOperators {
  eq(value: any): FilterCondition {
    return { type: 'eq', value };
  }
  
  ne(value: any): FilterCondition {
    return { type: 'ne', value };
  }
  
  gt(value: any): FilterCondition {
    return { type: 'gt', value };
  }
  
  gte(value: any): FilterCondition {
    return { type: 'gte', value };
  }
  
  lt(value: any): FilterCondition {
    return { type: 'lt', value };
  }
  
  lte(value: any): FilterCondition {
    return { type: 'lte', value };
  }
  
  like(pattern: string): FilterCondition {
    return { type: 'like', pattern };
  }
  
  ilike(pattern: string): FilterCondition {
    return { type: 'ilike', pattern };
  }
  
  in(values: any[]): FilterCondition {
    return { type: 'in', values };
  }
  
  notIn(values: any[]): FilterCondition {
    return { type: 'notIn', values };
  }
  
  between(min: any, max: any): FilterCondition {
    return { type: 'between', min, max };
  }
  
  isNull(): FilterCondition {
    return { type: 'isNull' };
  }
  
  isNotNull(): FilterCondition {
    return { type: 'isNotNull' };
  }
  
  and(...conditions: FilterCondition[]): FilterCondition {
    return { type: 'and', conditions };
  }
  
  or(...conditions: FilterCondition[]): FilterCondition {
    return { type: 'or', conditions };
  }
  
  not(condition: FilterCondition): FilterCondition {
    return { type: 'not', condition };
  }
}

/**
 * Query builder factory
 */
export class QueryBuilderFactory {
  static create<T>(executor: QueryExecutor<T>): QueryBuilder<T> {
    return new QueryBuilder<T>(executor);
  }
  
  static createWithOperators<T>(
    executor: QueryExecutor<T>, 
    operators: QueryOperators
  ): QueryBuilder<T> {
    return new QueryBuilder<T>(executor, operators);
  }
}