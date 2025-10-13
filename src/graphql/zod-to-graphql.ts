// Convert Zod schemas to GraphQL types
import type { ZodSchema, ZodTypeAny } from 'zod';
import { z } from 'zod';

/**
 * Convert a Zod schema to a GraphQL type string
 */
export function zodToGraphQLType(schema: ZodSchema): string {
  const zodType = (schema as any)._def.typeName;

  // Handle ZodString
  if (zodType === 'ZodString') {
    return 'String';
  }

  // Handle ZodNumber
  if (zodType === 'ZodNumber') {
    const def = (schema as any)._def;
    if (def.checks?.some((check: any) => check.kind === 'int')) {
      return 'Int';
    }
    return 'Float';
  }

  // Handle ZodBoolean
  if (zodType === 'ZodBoolean') {
    return 'Boolean';
  }

  // Handle ZodArray
  if (zodType === 'ZodArray') {
    const elementType = zodToGraphQLType((schema as any)._def.type);
    return `[${elementType}]`;
  }

  // Handle ZodObject
  if (zodType === 'ZodObject') {
    // For objects, we'll need to generate a custom type
    // Return a placeholder that will be replaced with the actual type name
    return 'JSON'; // GraphQL scalar for generic objects
  }

  // Handle ZodOptional
  if (zodType === 'ZodOptional') {
    return zodToGraphQLType((schema as any)._def.innerType);
  }

  // Handle ZodNullable
  if (zodType === 'ZodNullable') {
    return zodToGraphQLType((schema as any)._def.innerType);
  }

  // Handle ZodDefault
  if (zodType === 'ZodDefault') {
    return zodToGraphQLType((schema as any)._def.innerType);
  }

  // Handle ZodEnum
  if (zodType === 'ZodEnum') {
    // For enums, we'll need to generate a custom enum type
    return 'String'; // Fallback to String
  }

  // Handle ZodUnion
  if (zodType === 'ZodUnion') {
    // GraphQL doesn't support unions of scalars directly
    // We'll use the first option as fallback
    const options = (schema as any)._def.options;
    if (options && options.length > 0) {
      return zodToGraphQLType(options[0]);
    }
  }

  // Handle ZodLiteral
  if (zodType === 'ZodLiteral') {
    const value = (schema as any)._def.value;
    if (typeof value === 'string') return 'String';
    if (typeof value === 'number') return 'Float';
    if (typeof value === 'boolean') return 'Boolean';
  }

  // Handle ZodDate
  if (zodType === 'ZodDate') {
    return 'String'; // ISO date string
  }

  // Default fallback
  return 'String';
}

/**
 * Check if a Zod schema is nullable/optional
 */
export function isNullable(schema: ZodSchema): boolean {
  const zodType = (schema as any)._def.typeName;
  
  if (zodType === 'ZodOptional' || zodType === 'ZodNullable') {
    return true;
  }

  if (zodType === 'ZodDefault') {
    return isNullable((schema as any)._def.innerType);
  }

  return false;
}

/**
 * Get the default value from a Zod schema
 */
export function getDefaultValue(schema: ZodSchema): any {
  const zodType = (schema as any)._def.typeName;

  if (zodType === 'ZodDefault') {
    return (schema as any)._def.defaultValue();
  }

  if (zodType === 'ZodOptional' || zodType === 'ZodNullable') {
    const innerType = (schema as any)._def.innerType;
    if (innerType) {
      return getDefaultValue(innerType);
    }
  }

  return undefined;
}

/**
 * Generate GraphQL object type definition from Zod object schema
 */
export function zodObjectToGraphQLType(name: string, schema: ZodSchema): string {
  const zodType = (schema as any)._def.typeName;

  if (zodType !== 'ZodObject') {
    throw new Error('Schema must be a ZodObject');
  }

  const shape = (schema as any)._def.shape();
  const fields: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const fieldSchema = value as ZodTypeAny;
    const fieldType = zodToGraphQLType(fieldSchema);
    const nullable = isNullable(fieldSchema);
    const typeString = nullable ? fieldType : `${fieldType}!`;
    fields.push(`  ${key}: ${typeString}`);
  }

  return `type ${name} {\n${fields.join('\n')}\n}`;
}

/**
 * Generate GraphQL input type definition from Zod object schema
 */
export function zodObjectToGraphQLInput(name: string, schema: ZodSchema): string {
  const zodType = (schema as any)._def.typeName;

  if (zodType !== 'ZodObject') {
    throw new Error('Schema must be a ZodObject');
  }

  const shape = (schema as any)._def.shape();
  const fields: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const fieldSchema = value as ZodTypeAny;
    const fieldType = zodToGraphQLType(fieldSchema);
    const nullable = isNullable(fieldSchema);
    const defaultValue = getDefaultValue(fieldSchema);
    
    let typeString = nullable ? fieldType : `${fieldType}!`;
    
    if (defaultValue !== undefined) {
      const defaultStr = JSON.stringify(defaultValue);
      typeString += ` = ${defaultStr}`;
    }
    
    fields.push(`  ${key}: ${typeString}`);
  }

  return `input ${name} {\n${fields.join('\n')}\n}`;
}
