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
 * @param nameOrSchema - Optional specific parameter name or Zod schema for validation
 * @example
 * ```ts
 * @Get('/users')
 * listUsers(@Query() query: any) {}
 * 
 * @Get('/users')
 * listUsers(@Query('page') page: string) {}
 * 
 * @Get('/users')
 * listUsers(@Query(QuerySchema) query: { page: number, limit: number }) {}
 * ```
 */
export function Query<T extends ZodSchema>(nameOrSchema?: string | T): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'query',
      required: false
    };

    // Handle different parameter types
    if (typeof nameOrSchema === 'string') {
      // Specific parameter name
      metadata.name = nameOrSchema;
    } else if (nameOrSchema) {
      // Zod schema
      metadata.schema = nameOrSchema;
    }
    // If no parameter, extract all query parameters

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

/**
 * RequestId decorator - injects the current request ID
 * @example
 * ```ts
 * @Get('/users/:id')
 * async getUser(@Param('id') id: string, @RequestId() reqId: string) {
 *   logger.info({ requestId: reqId }, 'Fetching user');
 *   return { id, name: 'John' };
 * }
 * ```
 */
export function RequestId(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'request-id',
      required: false
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}

/**
 * AbortSignal decorator - injects the AbortSignal for the current request
 * Useful for cancelling long-running operations
 * @example
 * ```ts
 * @Get('/slow-operation')
 * async slowOperation(@AbortSignal() signal: AbortSignal) {
 *   return await longRunningTask({ signal });
 * }
 * ```
 */
export function AbortSignal(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;

    const metadata: ParameterMetadata = {
      index: parameterIndex,
      type: 'abort-signal',
      required: false
    };

    MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, metadata);
  };
}