// Parameter decorators
import type { ZodSchema } from 'zod';
import { MetadataRegistry } from '../core/metadata';
import type { ParameterMetadata } from '../types';

/**
 * Body decorator - extracts and validates request body
 * @param schema - Optional Zod schema for validation
 * @example
 * ```ts
 * @Post('/users')
 * createUser(@Body(UserSchema) data: User) {}
 * ```
 */
export function Body<T extends ZodSchema>(schema?: T): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'body',
      schema,
      required: true
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * Query decorator - extracts and validates query parameters
 * @param schema - Optional Zod schema for validation
 * @example
 * ```ts
 * @Get('/users')
 * listUsers(@Query(QuerySchema) query: { page: number, limit: number }) {}
 * ```
 */
export function Query<T extends ZodSchema>(schema?: T): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'query',
      schema,
      required: false
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * Param decorator - extracts route parameters
 * @param name - Optional specific parameter name to extract
 * @example
 * ```ts
 * @Get('/:id')
 * getUser(@Param('id') id: string) {}
 * 
 * // Or extract all params
 * @Get('/:userId/posts/:postId')
 * getPost(@Param() params: { userId: string, postId: string }) {}
 * ```
 */
export function Param(name?: string): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'param',
      name,
      required: true
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * Header decorator - extracts request headers
 * @param name - Optional specific header name to extract
 * @example
 * ```ts
 * @Get('/protected')
 * getProtected(@Header('authorization') auth: string) {}
 * 
 * // Or extract all headers
 * @Get('/info')
 * getInfo(@Header() headers: Record<string, string>) {}
 * ```
 */
export function Header(name?: string): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'header',
      name,
      required: false
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * Cookie decorator - extracts cookies
 * @param name - Optional specific cookie name to extract
 * @example
 * ```ts
 * @Get('/profile')
 * getProfile(@Cookie('session') sessionId: string) {}
 * 
 * // Or extract all cookies
 * @Get('/info')
 * getInfo(@Cookie() cookies: Record<string, string>) {}
 * ```
 */
export function Cookie(name?: string): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'cookie',
      name,
      required: false
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * Req decorator - injects the raw Hono Request object
 * @example
 * ```ts
 * @Get('/raw')
 * getRaw(@Req() req: Request) {}
 * ```
 */
export function Req(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'request',
      required: true
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * Ctx decorator - injects the Hono Context object
 * @example
 * ```ts
 * @Get('/context')
 * getContext(@Ctx() ctx: Context) {}
 * ```
 */
export function Ctx(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'context',
      required: true
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}
