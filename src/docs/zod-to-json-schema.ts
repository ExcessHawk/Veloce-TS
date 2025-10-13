// Zod to JSON Schema converter with support for reusable schemas
import type { ZodSchema } from 'zod';
import type { OpenAPISpec } from '../types';
import { zodToJsonSchema as baseZodToJsonSchema } from 'zod-to-json-schema';

/**
 * Schema cache to track schemas that should be reusable components
 */
const schemaCache = new WeakMap<ZodSchema, string>();
let schemaCounter = 0;

/**
 * Convert Zod schema to JSON Schema format
 * Handles primitive types, objects, arrays, unions, and generates reusable schemas
 */
export class ZodToJsonSchemaConverter {
  private spec: OpenAPISpec;
  private generatedSchemas: Set<string> = new Set();

  constructor(spec: OpenAPISpec) {
    this.spec = spec;
  }

  /**
   * Convert a Zod schema to JSON Schema
   * Automatically generates reusable schemas in components/schemas for complex types
   */
  convert(schema: ZodSchema, options?: { name?: string; reusable?: boolean }): any {
    try {
      // Check if this schema should be a reusable component
      if (options?.reusable || this.shouldBeReusable(schema)) {
        return this.convertToReusableSchema(schema, options?.name);
      }

      // Convert inline
      return this.convertInline(schema);
    } catch (error) {
      console.warn('Failed to convert Zod schema to JSON Schema:', error);
      return { type: 'object' };
    }
  }

  /**
   * Convert schema inline (not as a reusable component)
   */
  private convertInline(schema: ZodSchema): any {
    const jsonSchema = baseZodToJsonSchema(schema, {
      target: 'openApi3',
      $refStrategy: 'none'
    });

    // Remove $schema property as it's not needed in OpenAPI
    if (jsonSchema && typeof jsonSchema === 'object') {
      delete (jsonSchema as any).$schema;
    }

    return jsonSchema;
  }

  /**
   * Convert schema to a reusable component and return a $ref
   */
  private convertToReusableSchema(schema: ZodSchema, name?: string): any {
    // Check if we've already converted this schema
    const cachedName = schemaCache.get(schema);
    if (cachedName && this.generatedSchemas.has(cachedName)) {
      return { $ref: `#/components/schemas/${cachedName}` };
    }

    // Generate a name for the schema
    const schemaName = name || cachedName || this.generateSchemaName();
    schemaCache.set(schema, schemaName);
    this.generatedSchemas.add(schemaName);

    // Convert the schema
    const jsonSchema = this.convertInline(schema);

    // Store in components/schemas
    if (!this.spec.components) {
      this.spec.components = { schemas: {} };
    }
    if (!this.spec.components.schemas) {
      this.spec.components.schemas = {};
    }

    this.spec.components.schemas[schemaName] = jsonSchema;

    // Return a reference
    return { $ref: `#/components/schemas/${schemaName}` };
  }

  /**
   * Determine if a schema should be converted to a reusable component
   * Complex objects and arrays should be reusable
   */
  private shouldBeReusable(schema: ZodSchema): boolean {
    // Convert to JSON Schema to inspect structure
    const jsonSchema = this.convertInline(schema);

    // Objects with properties should be reusable
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const propertyCount = Object.keys(jsonSchema.properties).length;
      return propertyCount > 2; // More than 2 properties = reusable
    }

    // Arrays with complex items should be reusable
    if (jsonSchema.type === 'array' && jsonSchema.items) {
      const items = jsonSchema.items;
      if (items.type === 'object' && items.properties) {
        return true;
      }
    }

    // Unions/anyOf should be reusable
    if (jsonSchema.anyOf || jsonSchema.oneOf || jsonSchema.allOf) {
      return true;
    }

    return false;
  }

  /**
   * Generate a unique schema name
   */
  private generateSchemaName(): string {
    return `Schema${++schemaCounter}`;
  }

  /**
   * Reset the schema counter (useful for testing)
   */
  static resetCounter(): void {
    schemaCounter = 0;
  }
}

/**
 * Helper function to convert Zod schema to JSON Schema
 * This is a simpler interface for one-off conversions
 */
export function zodToJsonSchema(schema: ZodSchema, spec?: OpenAPISpec): any {
  if (spec) {
    const converter = new ZodToJsonSchemaConverter(spec);
    return converter.convert(schema);
  }

  // Fallback to inline conversion without spec
  try {
    const jsonSchema = baseZodToJsonSchema(schema, {
      target: 'openApi3',
      $refStrategy: 'none'
    });

    if (jsonSchema && typeof jsonSchema === 'object') {
      delete (jsonSchema as any).$schema;
    }

    return jsonSchema;
  } catch (error) {
    console.warn('Failed to convert Zod schema to JSON Schema:', error);
    return { type: 'object' };
  }
}
