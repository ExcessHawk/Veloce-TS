import { z } from 'zod';

// Drizzle-specific types and interfaces
export interface DrizzleConfig {
  logger?: boolean;
  schema?: Record<string, any>;
  mode?: 'default' | 'planetscale';
}

export interface DrizzleTableMetadata {
  name: string;
  schema?: string;
  columns: DrizzleColumnMetadata[];
  relations: DrizzleRelationMetadata[];
  zodSchema?: z.ZodSchema;
}

export interface DrizzleColumnMetadata {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  hasDefault: boolean;
  isUnique: boolean;
  isAutoIncrement: boolean;
  enumValues?: string[];
}

export interface DrizzleRelationMetadata {
  name: string;
  type: 'one' | 'many';
  referencedTable: string;
  referencedColumn?: string;
  relationName?: string;
}

// Drizzle database interfaces (generic to avoid direct dependency)
export interface DrizzleDatabase {
  select(fields?: any): DrizzleSelectBuilder;
  insert(table: any): DrizzleInsertBuilder;
  update(table: any): DrizzleUpdateBuilder;
  delete(table: any): DrizzleDeleteBuilder;
  transaction<T>(callback: (tx: DrizzleDatabase) => Promise<T>): Promise<T>;
  execute(query: any): Promise<any>;
  $with(alias: string): any;
}

export interface DrizzleSelectBuilder {
  from(table: any): DrizzleSelectBuilder;
  where(condition: any): DrizzleSelectBuilder;
  orderBy(...columns: any[]): DrizzleSelectBuilder;
  groupBy(...columns: any[]): DrizzleSelectBuilder;
  having(condition: any): DrizzleSelectBuilder;
  limit(count: number): DrizzleSelectBuilder;
  offset(count: number): DrizzleSelectBuilder;
  leftJoin(table: any, condition: any): DrizzleSelectBuilder;
  rightJoin(table: any, condition: any): DrizzleSelectBuilder;
  innerJoin(table: any, condition: any): DrizzleSelectBuilder;
  fullJoin(table: any, condition: any): DrizzleSelectBuilder;
  execute(): Promise<any[]>;
  then(onfulfilled?: any, onrejected?: any): Promise<any[]>;
}

export interface DrizzleInsertBuilder {
  values(values: any | any[]): DrizzleInsertBuilder;
  onConflictDoNothing(): DrizzleInsertBuilder;
  onConflictDoUpdate(config: any): DrizzleInsertBuilder;
  returning(fields?: any): DrizzleInsertBuilder;
  execute(): Promise<any>;
  then(onfulfilled?: any, onrejected?: any): Promise<any>;
}

export interface DrizzleUpdateBuilder {
  set(values: any): DrizzleUpdateBuilder;
  where(condition: any): DrizzleUpdateBuilder;
  returning(fields?: any): DrizzleUpdateBuilder;
  execute(): Promise<any>;
  then(onfulfilled?: any, onrejected?: any): Promise<any>;
}

export interface DrizzleDeleteBuilder {
  where(condition: any): DrizzleDeleteBuilder;
  returning(fields?: any): DrizzleDeleteBuilder;
  execute(): Promise<any>;
  then(onfulfilled?: any, onrejected?: any): Promise<any>;
}

// Drizzle table schema interface
export interface DrizzleTable {
  _: {
    name: string;
    schema?: string;
    columns: Record<string, DrizzleColumn>;
    primaryKey?: any;
    foreignKeys?: any[];
    indexes?: any[];
  };
}

export interface DrizzleColumn {
  _: {
    name: string;
    dataType: string;
    columnType: string;
    notNull: boolean;
    hasDefault: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    enumValues?: string[];
  };
}

// Drizzle repository options
export interface DrizzleRepositoryOptions<T> {
  table: DrizzleTable;
  database: DrizzleDatabase;
  zodSchema?: z.ZodSchema<T>;
}

// Drizzle query operators
export interface DrizzleOperators {
  eq: (column: any, value: any) => any;
  ne: (column: any, value: any) => any;
  gt: (column: any, value: any) => any;
  gte: (column: any, value: any) => any;
  lt: (column: any, value: any) => any;
  lte: (column: any, value: any) => any;
  like: (column: any, value: string) => any;
  ilike: (column: any, value: string) => any;
  inArray: (column: any, values: any[]) => any;
  notInArray: (column: any, values: any[]) => any;
  isNull: (column: any) => any;
  isNotNull: (column: any) => any;
  between: (column: any, min: any, max: any) => any;
  and: (...conditions: any[]) => any;
  or: (...conditions: any[]) => any;
  not: (condition: any) => any;
}