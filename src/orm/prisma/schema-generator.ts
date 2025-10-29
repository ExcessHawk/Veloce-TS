import { z } from 'zod';
import { PrismaModelMetadata, PrismaFieldMetadata } from './types';

/**
 * Generates Zod schemas from Prisma schema metadata
 */
export class PrismaZodSchemaGenerator {
  private modelSchemas = new Map<string, z.ZodSchema>();
  
  /**
   * Generate Zod schema for a Prisma model
   */
  generateModelSchema(model: PrismaModelMetadata): z.ZodSchema {
    if (this.modelSchemas.has(model.name)) {
      return this.modelSchemas.get(model.name)!;
    }
    
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    
    for (const field of model.fields) {
      schemaFields[field.name] = this.generateFieldSchema(field);
    }
    
    const schema = z.object(schemaFields);
    this.modelSchemas.set(model.name, schema);
    
    return schema;
  }
  
  /**
   * Generate Zod schema for a Prisma field
   */
  private generateFieldSchema(field: PrismaFieldMetadata): z.ZodTypeAny {
    let schema = this.getBaseSchema(field.type);
    
    // Handle arrays/lists
    if (field.isList) {
      schema = z.array(schema);
    }
    
    // Handle optional fields
    if (field.isOptional) {
      schema = schema.optional();
    }
    
    // Add validation for unique fields
    if (field.isUnique) {
      // Note: Actual uniqueness validation would need database access
      // This is just a marker for documentation
      schema = schema.describe(`Unique field: ${field.name}`);
    }
    
    return schema;
  }
  
  /**
   * Get base Zod schema for Prisma field type
   */
  private getBaseSchema(prismaType: string): z.ZodTypeAny {
    switch (prismaType.toLowerCase()) {
      case 'string':
        return z.string();
      case 'int':
      case 'integer':
        return z.number().int();
      case 'float':
      case 'decimal':
        return z.number();
      case 'boolean':
      case 'bool':
        return z.boolean();
      case 'datetime':
      case 'timestamp':
        return z.date();
      case 'json':
        return z.record(z.any());
      case 'bytes':
        return z.instanceof(Buffer);
      case 'bigint':
        return z.bigint();
      default:
        // For custom types or enums, return string by default
        return z.string();
    }
  }
  
  /**
   * Generate create schema (without auto-generated fields)
   */
  generateCreateSchema(model: PrismaModelMetadata): z.ZodSchema {
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    
    for (const field of model.fields) {
      // Skip auto-generated fields like id, createdAt, updatedAt
      if (field.isId && field.hasDefaultValue) {
        continue;
      }
      
      if (field.name === 'createdAt' || field.name === 'updatedAt') {
        continue;
      }
      
      schemaFields[field.name] = this.generateFieldSchema(field);
    }
    
    return z.object(schemaFields);
  }
  
  /**
   * Generate update schema (all fields optional)
   */
  generateUpdateSchema(model: PrismaModelMetadata): z.ZodSchema {
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    
    for (const field of model.fields) {
      // Skip id field in updates
      if (field.isId) {
        continue;
      }
      
      // Skip auto-updated fields
      if (field.name === 'updatedAt') {
        continue;
      }
      
      let fieldSchema = this.generateFieldSchema(field);
      
      // Make all fields optional for updates
      if (!fieldSchema.isOptional()) {
        fieldSchema = fieldSchema.optional();
      }
      
      schemaFields[field.name] = fieldSchema;
    }
    
    return z.object(schemaFields);
  }
  
  /**
   * Parse Prisma schema file and extract model metadata
   */
  static parsePrismaSchema(schemaContent: string): PrismaModelMetadata[] {
    const models: PrismaModelMetadata[] = [];
    const lines = schemaContent.split('\n');
    
    let currentModel: PrismaModelMetadata | null = null;
    let inModel = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Start of model
      if (trimmedLine.startsWith('model ')) {
        const modelName = trimmedLine.split(' ')[1];
        currentModel = {
          name: modelName,
          fields: [],
          relations: []
        };
        inModel = true;
        continue;
      }
      
      // End of model
      if (trimmedLine === '}' && inModel && currentModel) {
        models.push(currentModel);
        currentModel = null;
        inModel = false;
        continue;
      }
      
      // Field definition
      if (inModel && currentModel && trimmedLine && !trimmedLine.startsWith('//')) {
        const field = this.parseField(trimmedLine);
        if (field) {
          currentModel.fields.push(field);
        }
      }
    }
    
    return models;
  }
  
  /**
   * Parse a Prisma field definition
   */
  private static parseField(fieldLine: string): PrismaFieldMetadata | null {
    // Basic parsing - in a real implementation, you'd want a proper parser
    const parts = fieldLine.trim().split(/\s+/);
    if (parts.length < 2) return null;
    
    const name = parts[0];
    const typeInfo = parts[1];
    
    // Parse type information
    const isOptional = typeInfo.includes('?');
    const isList = typeInfo.includes('[]');
    const baseType = typeInfo.replace('?', '').replace('[]', '');
    
    // Check for attributes
    const attributes = fieldLine.includes('@') ? fieldLine.split('@').slice(1) : [];
    const isId = attributes.some(attr => attr.startsWith('id'));
    const isUnique = attributes.some(attr => attr.startsWith('unique'));
    const hasDefaultValue = attributes.some(attr => attr.startsWith('default'));
    
    return {
      name,
      type: baseType,
      isOptional,
      isList,
      isId,
      isUnique,
      hasDefaultValue
    };
  }
  
  /**
   * Generate all schemas for a model (base, create, update)
   */
  generateAllSchemas(model: PrismaModelMetadata) {
    return {
      base: this.generateModelSchema(model),
      create: this.generateCreateSchema(model),
      update: this.generateUpdateSchema(model)
    };
  }
}