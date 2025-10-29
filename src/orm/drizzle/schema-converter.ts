import { z } from 'zod';
import { DrizzleTable, DrizzleColumn, DrizzleTableMetadata, DrizzleColumnMetadata } from './types';

/**
 * Converts Drizzle schemas to Zod schemas for validation
 */
export class DrizzleZodSchemaConverter {
  private tableSchemas = new Map<string, z.ZodSchema>();
  
  /**
   * Convert Drizzle table schema to Zod schema
   */
  convertTableToZod(table: DrizzleTable): z.ZodSchema {
    const tableName = table._.name;
    
    if (this.tableSchemas.has(tableName)) {
      return this.tableSchemas.get(tableName)!;
    }
    
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    
    for (const [columnName, column] of Object.entries(table._.columns)) {
      schemaFields[columnName] = this.convertColumnToZod(column);
    }
    
    const schema = z.object(schemaFields);
    this.tableSchemas.set(tableName, schema);
    
    return schema;
  }
  
  /**
   * Convert Drizzle column to Zod schema
   */
  private convertColumnToZod(column: DrizzleColumn): z.ZodTypeAny {
    let schema = this.getBaseZodSchema(column);
    
    // Handle nullable columns
    if (!column._.notNull) {
      schema = schema.nullable();
    }
    
    // Handle optional columns (those with defaults or nullable)
    if (column._.hasDefault || !column._.notNull) {
      schema = schema.optional();
    }
    
    return schema;
  }
  
  /**
   * Get base Zod schema for Drizzle column type
   */
  private getBaseZodSchema(column: DrizzleColumn): z.ZodTypeAny {
    const dataType = column._.dataType.toLowerCase();
    const columnType = column._.columnType.toLowerCase();
    
    // Handle enum types
    if (column._.enumValues && column._.enumValues.length > 0) {
      return z.enum(column._.enumValues as [string, ...string[]]);
    }
    
    // Handle specific column types
    switch (columnType) {
      case 'serial':
      case 'bigserial':
        return z.number().int().positive();
      case 'boolean':
        return z.boolean();
      case 'date':
        return z.date();
      case 'timestamp':
      case 'timestamptz':
        return z.date();
      case 'json':
      case 'jsonb':
        return z.record(z.any());
      case 'uuid':
        return z.string().uuid();
      case 'text':
      case 'varchar':
      case 'char':
        return z.string();
      case 'integer':
      case 'int':
      case 'int4':
        return z.number().int();
      case 'bigint':
      case 'int8':
        return z.bigint();
      case 'smallint':
      case 'int2':
        return z.number().int().min(-32768).max(32767);
      case 'real':
      case 'float4':
        return z.number();
      case 'double precision':
      case 'float8':
        return z.number();
      case 'decimal':
      case 'numeric':
        return z.number();
      case 'bytea':
        return z.instanceof(Buffer);
      default:
        // Fall back to data type
        return this.getBaseZodSchemaByDataType(dataType);
    }
  }
  
  /**
   * Get base Zod schema by data type
   */
  private getBaseZodSchemaByDataType(dataType: string): z.ZodTypeAny {
    switch (dataType) {
      case 'string':
      case 'text':
        return z.string();
      case 'number':
      case 'integer':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'date':
        return z.date();
      case 'json':
        return z.record(z.any());
      case 'buffer':
        return z.instanceof(Buffer);
      case 'bigint':
        return z.bigint();
      default:
        return z.string(); // Default fallback
    }
  }
  
  /**
   * Generate create schema (without auto-generated fields)
   */
  generateCreateSchema(table: DrizzleTable): z.ZodSchema {
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    
    for (const [columnName, column] of Object.entries(table._.columns)) {
      // Skip auto-generated primary keys
      if (column._.isPrimaryKey && column._.hasDefault) {
        continue;
      }
      
      // Skip auto-increment columns
      if (column._.columnType.includes('serial')) {
        continue;
      }
      
      schemaFields[columnName] = this.convertColumnToZod(column);
    }
    
    return z.object(schemaFields);
  }
  
  /**
   * Generate update schema (all fields optional)
   */
  generateUpdateSchema(table: DrizzleTable): z.ZodSchema {
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    
    for (const [columnName, column] of Object.entries(table._.columns)) {
      // Skip primary key in updates
      if (column._.isPrimaryKey) {
        continue;
      }
      
      let fieldSchema = this.convertColumnToZod(column);
      
      // Make all fields optional for updates
      if (!fieldSchema.isOptional()) {
        fieldSchema = fieldSchema.optional();
      }
      
      schemaFields[columnName] = fieldSchema;
    }
    
    return z.object(schemaFields);
  }
  
  /**
   * Extract table metadata from Drizzle table
   */
  extractTableMetadata(table: DrizzleTable): DrizzleTableMetadata {
    const columns: DrizzleColumnMetadata[] = [];
    
    for (const [columnName, column] of Object.entries(table._.columns)) {
      columns.push({
        name: columnName,
        dataType: column._.dataType,
        isPrimaryKey: column._.isPrimaryKey,
        isNotNull: column._.notNull,
        hasDefault: column._.hasDefault,
        isUnique: column._.isUnique,
        isAutoIncrement: column._.columnType.includes('serial'),
        enumValues: column._.enumValues
      });
    }
    
    return {
      name: table._.name,
      schema: table._.schema,
      columns,
      relations: [], // Relations would need to be extracted from schema definition
      zodSchema: this.convertTableToZod(table)
    };
  }
  
  /**
   * Generate all schemas for a table (base, create, update)
   */
  generateAllSchemas(table: DrizzleTable) {
    return {
      base: this.convertTableToZod(table),
      create: this.generateCreateSchema(table),
      update: this.generateUpdateSchema(table)
    };
  }
  
  /**
   * Clear cached schemas
   */
  clearCache(): void {
    this.tableSchemas.clear();
  }
  
  /**
   * Get cached schema for a table
   */
  getCachedSchema(tableName: string): z.ZodSchema | undefined {
    return this.tableSchemas.get(tableName);
  }
}