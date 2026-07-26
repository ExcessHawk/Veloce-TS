// Zod to JSON Schema converter with support for reusable schemas (OpenAPI 3.1)
import type { ZodSchema } from 'zod';
import type { OpenAPISpec } from '../types';
import { zodToJsonSchema as baseZodToJsonSchema } from 'zod-to-json-schema';

/**
 * Recursively normalize a JSON Schema object from OpenAPI 3.0 to 3.1 format.
 * Key change: `nullable: true` is not valid in 3.1 — replaced with type arrays.
 */
function normalizeFor31(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeFor31);

  const result: any = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable') continue; // drop; handled below
    result[key] = typeof value === 'object' && value !== null ? normalizeFor31(value) : value;
  }

  // Convert nullable:true to type array
  if ((schema as any).nullable === true) {
    const base = result.type;
    if (base && typeof base === 'string') {
      result.type = [base, 'null'];
    } else if (Array.isArray(base)) {
      if (!base.includes('null')) result.type = [...base, 'null'];
    } else {
      // No simple type — wrap with oneOf
      const { ...rest } = result;
      delete rest.nullable;
      return { oneOf: [rest, { type: 'null' }] };
    }
  }

  return result;
}

/**
 * Convert Zod schema to JSON Schema format
 * Handles primitive types, objects, arrays, unions, and generates reusable schemas
 *
 * All naming state (schema-to-name cache, anonymous counter) is per converter
 * instance, so repeated generator runs always produce identical names.
 */
export class ZodToJsonSchemaConverter {
  private spec: OpenAPISpec;
  /** Component names already emitted into the spec by this converter */
  private generatedSchemas: Set<string> = new Set();
  /** Maps a Zod schema to the component name it was registered under */
  private schemaNames = new WeakMap<ZodSchema, string>();
  /** Fallback counter for fully anonymous schemas (per instance, deterministic per run) */
  private anonymousCounter = 0;

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

    // Normalize to OpenAPI 3.1 (replace nullable:true with type arrays)
    return normalizeFor31(jsonSchema);
  }

  /**
   * Convert schema to a reusable component and return a $ref
   */
  private convertToReusableSchema(schema: ZodSchema, name?: string): any {
    // Check if we've already converted this schema in this instance
    const cachedName = this.schemaNames.get(schema);
    if (cachedName) {
      return { $ref: `#/components/schemas/${cachedName}` };
    }

    // Resolve a meaningful, sanitized, deduplicated name for the schema
    const schemaName = this.resolveSchemaName(schema, name);
    this.schemaNames.set(schema, schemaName);
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
   * Resolve a component name for a schema. Priority:
   * 1. `.describe()` value when it is a plain identifier (e.g. `z.object(...).describe('User')`).
   *    Prose descriptions ("A user record") are NOT used as names — they stay as
   *    the schema `description` field only.
   * 2. Name hint provided by the caller (route/DTO metadata, or a stable name
   *    derived from controller + method + kind, e.g. "UserControllerCreateBody").
   * 3. Anonymous fallback: Schema1, Schema2... (counter is per converter instance).
   *
   * The result is sanitized to [A-Za-z0-9_] and deduplicated deterministically
   * (colliding names get suffixes _2, _3, ...).
   */
  private resolveSchemaName(schema: ZodSchema, nameHint?: string): string {
    const described = ZodToJsonSchemaConverter.identifierFromDescription(schema);
    const base =
      described ??
      (nameHint ? ZodToJsonSchemaConverter.sanitizeName(nameHint) : undefined) ??
      `Schema${++this.anonymousCounter}`;

    // Deduplicate deterministically: Name, Name_2, Name_3, ...
    let candidate = base;
    let suffix = 2;
    while (this.generatedSchemas.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    return candidate;
  }

  /**
   * Return the `.describe()` text when it is usable as a component name,
   * i.e. a single identifier like "User" or "CreateUserDto".
   */
  private static identifierFromDescription(schema: ZodSchema): string | undefined {
    const description = (schema as any)?._def?.description;
    if (typeof description === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(description)) {
      return description;
    }
    return undefined;
  }

  /**
   * Sanitize a name to [A-Za-z0-9_]; returns undefined when nothing remains.
   */
  private static sanitizeName(name: string): string | undefined {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '');
    if (!cleaned) return undefined;
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  }

  /**
   * @deprecated Naming state is now per converter instance, so there is no
   * global counter to reset. Kept as a no-op for backward compatibility.
   */
  static resetCounter(): void {
    // no-op
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

    return normalizeFor31(jsonSchema);
  } catch (error) {
    console.warn('Failed to convert Zod schema to JSON Schema:', error);
    return { type: 'object' };
  }
}
