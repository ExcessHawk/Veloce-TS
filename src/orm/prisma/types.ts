import { z } from 'zod';

// Prisma-specific types and interfaces
export interface PrismaConfig {
  datasourceUrl?: string;
  log?: ('query' | 'info' | 'warn' | 'error')[];
  errorFormat?: 'pretty' | 'colorless' | 'minimal';
  generateZodSchemas?: boolean;
  schemaPath?: string;
  outputPath?: string;
}

export interface PrismaModelMetadata {
  name: string;
  fields: PrismaFieldMetadata[];
  relations: PrismaRelationMetadata[];
  zodSchema?: z.ZodSchema;
}

export interface PrismaFieldMetadata {
  name: string;
  type: string;
  isOptional: boolean;
  isList: boolean;
  isId: boolean;
  isUnique: boolean;
  hasDefaultValue: boolean;
  relationName?: string;
}

export interface PrismaRelationMetadata {
  name: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  model: string;
  fields?: string[];
  references?: string[];
}

// Prisma client interface (generic to avoid direct dependency)
export interface PrismaClientLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (prisma: this) => Promise<T>, options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  }): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: any[]): Promise<number>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]): Promise<T>;
}

// Prisma delegate interface for model operations
export interface PrismaDelegate {
  create(args: any): Promise<any>;
  findUnique(args: any): Promise<any>;
  findFirst(args: any): Promise<any>;
  findMany(args: any): Promise<any[]>;
  update(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  delete(args: any): Promise<any>;
  deleteMany(args: any): Promise<{ count: number }>;
  count(args?: any): Promise<number>;
  aggregate(args: any): Promise<any>;
  groupBy(args: any): Promise<any[]>;
}

// Prisma repository options
export interface PrismaRepositoryOptions {
  model: string;
  client: PrismaClientLike;
  delegate: PrismaDelegate;
  zodSchema?: z.ZodSchema;
}