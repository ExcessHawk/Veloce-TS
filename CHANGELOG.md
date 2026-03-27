# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] - 2026-03-27

### Fixed
- **HealthCheckPlugin:** checker display names are set with `Object.defineProperty` (with a fallback) so runtimes such as Bun do not throw when assigning `.name` on async checker functions.
- **Public API:** `@Req` is now exported from the main `veloce-ts` entry (it was implemented in `decorators/params` but missing from the package exports).

## [0.4.1] - 2026-03-27

### Fixed
- `include()` in `VeloceTS` application no longer drops decorator-set route fields (e.g. `statusCode` from `@HttpCode`, `responseSchema` from `@ResponseSchema`) when registering controller routes.

### Added
- New test suite: `tests/routing.test.ts`, `tests/validation.test.ts`, `tests/errors.test.ts`, `tests/di.test.ts` — 53 integration tests covering functional API, decorator routing, body/query validation, HTTP exceptions, and DI container.
- Console-based fallback logger: if `pino` is not installed, the framework now falls back silently to a `console`-based logger instead of crashing at startup.

### Changed
- `pino`, `pino-pretty`, and `ioredis` moved from `dependencies` to `optionalDependencies`. They are no longer installed automatically, reducing the default install footprint by ~7 MB. Install them explicitly if needed (`bun add pino pino-pretty` / `bun add ioredis`).
- `winston` removed from `dependencies` entirely (it was listed but never used by the framework).
- `@types/ioredis` and `@types/pino` removed from `devDependencies` (no longer needed).
- Build threshold in `build.ts` updated from 100 KB to 600 KB to reflect the full framework scope.
- Core bundle reduced from 444 KB to 408 KB (minified ESM).

### Deprecated
- `FastAPITS` export: use `VeloceTS` or the shorter `Veloce` alias instead. `FastAPITS` will be removed in v1.0.0.

## [0.4.0] - 2026-03-27

Esta versión representa la mayor actualización desde el lanzamiento inicial. Se añadieron más de 25 mejoras nuevas distribuidas en tres oleadas de trabajo (alta, media y baja prioridad), cubriendo la cadena completa desde la generación de rutas hasta la documentación OpenAPI, el testing, el ORM y la CLI.

### 🚀 Nuevos Decoradores

#### Documentación OpenAPI (shorthand)
Cinco decoradores de una sola línea como alternativa concisa a `@ApiDoc({...})`:
- **`@Summary(text)`** — descripción corta visible en la lista de Swagger UI
- **`@Description(text)`** — texto largo en el panel de detalle de la operación
- **`@Tag(name)`** — asigna un tag individual; apilable con múltiples `@Tag`
- **`@Tags(...names)`** — asigna varios tags en un solo decorador
- **`@Deprecated()`** — marca la ruta como obsoleta (tachado en Swagger UI)

#### Control de respuesta
- **`@HttpCode(statusCode)`** — sobreescribe el código HTTP de respuesta del handler (p.ej. `201` para creación). Usado también por el generador OpenAPI para el código de éxito documentado
- **`@ResponseSchema(schema, statusCode?)`** — valida y sanitiza la respuesta del handler con un esquema Zod; informa el modelo de respuesta al spec de OpenAPI

#### Middleware declarativo por ruta
- **`@Timeout(ms, message?)`** — aborta la petición con **408 Request Timeout** si el handler supera el límite. Inyecta automáticamente el middleware al inicio del pipeline y emite el header `X-Timeout-Ms`
- **`@RateLimit(options)`** — aplica rate-limiting a nivel de ruta individual usando la misma configuración de `createRateLimitMiddleware()`. Los headers estándar `X-RateLimit-*` se envían automáticamente

### 🛠️ Mejoras al Framework Core

#### OpenAPI Generator (`src/docs/openapi-generator.ts`)
- **Auto-tagging**: deriva tags automáticamente del primer segmento del path (`/products/:id` → tag `"Products"`) sin necesidad de anotarlos manualmente
- **Bearer security scheme**: añade `components.securitySchemes.bearerAuth` al spec y aplica `security: [{ bearerAuth: [] }]` en rutas protegidas de forma automática
- **401 automático**: rutas protegidas reciben una respuesta `401 Unauthorized` documentada sin configuración adicional
- **Soporte de `@HttpCode`**: usa el `statusCode` del decorador como clave del bloque de éxito en `responses`
- **`@ResponseSchema` en el spec**: cuando está presente, el esquema Zod se convierte al formato JSON Schema para el bloque de contenido de la respuesta

#### Sistema de Excepciones HTTP (`src/errors/exceptions.ts`)
Seis nuevas clases de excepción para cubrir casos de error comunes:
- `ConflictException` (409)
- `GoneException` (410)
- `PayloadTooLargeException` (413)
- `UnprocessableEntityException` (422)
- `TooManyRequestsException` (429)
- `ServiceUnavailableException` (503)

#### Logger estructurado en ErrorHandler (`src/errors/handler.ts`)
- Errores 5xx se registran con `getLogger().error` incluyendo path, método, status y stack
- Errores 4xx se registran como `warn` en entorno de desarrollo
- Errores genéricos no capturados también pasan por Pino

#### Arreglos de orden de decoradores
- **`@UseMiddleware`** (`src/decorators/middleware.ts`): ahora siempre llama a `MetadataRegistry.defineRoute` para que el middleware no se pierda independientemente del orden de ejecución de los decoradores
- **`@Cache` / `@CacheInvalidate`** (`src/decorators/cache.ts`): mismo patrón — los metadatos se fusionan correctamente sin importar el orden de apilamiento

#### MetadataCompiler — caché lazy con snapshots (`src/core/compiled-metadata.ts`)
- Compilación lazy: una ruta sólo se recompila si sus metadatos cambiaron (comparación por snapshot JSON)
- IDs únicos para handlers funcionales vía `WeakMap<Function, number>` — evita colisiones de caché cuando distintas instancias de app registran el mismo path con handlers diferentes (bug crítico en tests paralelos)
- Método `clearCache()` expuesto para limpiar el estado entre tests

### 🧪 TestClient — API fluida y helpers de autenticación (`src/testing/test-client.ts`)

Reescritura completa de `TestClient`:
- **`TestResponse`** — nueva clase de respuesta con propiedades `status`, `headers`, `body`, `text`, `ok` y métodos de aserción encadenables:
  - `expectStatus(code)`, `expectOk()`, `expectCreated()`, `expectNotFound()`, etc.
  - `expectJson(partialObject)` — comprobación parcial del body
  - `expectField(field, value?)` — verificar un campo específico
  - `expectHeader(name, value?)` — verificar un header de respuesta
  - `expectArrayLength(n)` — verificar longitud de array en respuesta
- **`withToken(token)`** — crea una instancia inmutable del cliente con el header `Authorization: Bearer` ya configurado
- **`withHeaders(headers)`** — crea una instancia inmutable con headers adicionales
- **`loginAs(credentials, endpoint?)`** — hace login, extrae el JWT y lo inyecta en el cliente actual para las peticiones siguientes
- **`registerAndLogin(user, endpoints?)`** — registra y hace login en una sola llamada
- **`clearAuth()`** — limpia el token almacenado

### 🔌 Plugins y Middleware

#### HealthCheckers.disk (`src/plugins/health.ts`)
- Usa `fs.statfs` (Node 18+ / Bun) para obtener métricas reales de disco: total, libre, usado y porcentaje
- Degradación elegante a `"healthy"` en plataformas sin soporte

#### CLI — Plantilla Fullstack corregida (`src/cli/commands/new.ts`)
- La plantilla `fullstack` ahora genera `src/index.ts` con `GraphQLPlugin` y `WebSocketPlugin` correctamente importados e instanciados (antes quedaban comentados)

#### Subpath exports en el build (`build.ts`)
- Se añadieron `./src/auth/index.ts`, `./src/adapters/base.ts`, `./src/adapters/hono.ts`, `./src/adapters/express.ts` como entrypoints explícitos para que los imports `veloce-ts/auth` y `veloce-ts/adapters/*` funcionen correctamente

### 🗄️ Drizzle ORM — Integración DI (`src/dependencies/drizzle.ts`)

Nuevo módulo para conectar Drizzle (u otro ORM) al contenedor de inyección de dependencias:
```typescript
// Registrar la instancia de la DB
registerDrizzle(app, db);

// Inyectar en controladores
@Get('/')
async list(@InjectDB() db: DrizzleDB) { … }
```
- `DB_TOKEN` — símbolo por defecto para el token de inyección
- `registerDrizzle(app, db, token?)` — registra como singleton en el `DIContainer`
- `@InjectDB(token?)` — decorador de parámetro, alias de `@Depends(DB_TOKEN)`

### 📊 Paginación mejorada (`src/orm/pagination.ts`)

#### Enriquecimiento de metadatos
- `PaginationMeta` incluye `from` y `to` (rango 1-based, p.ej. `from: 11, to: 20`)
- `CursorPaginatedResult` incluye `count` (ítems reales devueltos en la página)

#### Cursor pagination más precisa
- `createCursorPaginatedResult(data, limit, cursorField, hadPrevCursor)` — el nuevo parámetro `hadPrevCursor` activa `hasPrev: true` correctamente cuando se navega hacia adelante con cursor
- `createMultiCursor(entity, fields[])` — crea cursores compuestos por múltiples campos para ordenación estable (p.ej. `{ createdAt, id }`)
- `decodeMultiCursor(cursor)` — decodifica un cursor multi-campo de vuelta a un objeto

#### Helpers standalone
- `paginate<T>(data, total, page, limit)` — construye `{ data, meta }` en una sola llamada, sin necesidad de instanciar `PaginationHelper`
- `parseCursorQuery(query, defaultLimit?, maxLimit?)` — extrae `cursor` y `limit` de los query params sin lanzar excepciones
- `PaginationHelper.parsePaginationQuery(query, defaultLimit?, maxLimit?)` — equivalente para paginación offset; aplica límite máximo y usa defaults cuando los valores son inválidos

### 🔌 Express Adapter — Compatibilidad ESM (`src/adapters/express.ts`)

Reescritura completa del adaptador:
- Carga Express de forma lazy y segura usando `Function('return require')()` para compatibilidad ESM sin necesitar `declare const require: any`
- Acepta una instancia de Express pre-creada como segundo argumento del constructor (para añadir middleware propio antes del bridge)
- Manejo correcto de body raw (`Buffer`) vs body parseado (JSON/urlencoded)
- Omite el header `transfer-encoding` al reenviar respuestas (era fuente de errores en Express)
- Delega errores inesperados al pipeline de error de Express mediante `next(err)` en lugar de responder con 500 directamente

### 🐛 Bug Fixes

- **`ZodError` cross-module** (`src/errors/handler.ts`, `src/validation/validator.ts`): `instanceof ZodError` fallaba cuando la app consumidora tenía una instancia de Zod diferente a la del framework (caso frecuente con `bun link`). Añadido fallback `error.name === 'ZodError'` para garantizar respuestas 422 en todos los casos
- **Rutas `GET` marcadas públicas retornaban 401** en `products-api`: `app.use()` aplicaba el middleware a todos los métodos; corregido usando `app.on(['POST', 'PUT', 'DELETE'], path, middleware)` para restringir sólo a métodos de escritura
- **Cache collision en MetadataCompiler**: handlers funcionales distintos con el mismo path en diferentes instancias de app compartían el resultado compilado incorrecto; solucionado con IDs únicos por función
- **`@Cache` / `@UseMiddleware` perdían metadatos**: cuando se apilaban en orden inverso al de ejecución de decoradores, los metadatos podían sobreescribirse; solucionado actualizando el registro explícitamente en cada decorador

### 📋 Mensajes de validación mejorados (`src/validation/exceptions.ts`)

La respuesta de error `422` ahora incluye información estructurada adicional:
- `field` en formato convencional: `items[0].price` en lugar de `items.0.price`
- `received` — tipo recibido (cuando Zod lo reporta)
- `expected` — tipo esperado (cuando aplica)
- `minimum` / `maximum` — límites numéricos en errores de rango

```json
{
  "error": "Validation Error",
  "statusCode": 422,
  "details": [
    { "field": "email",        "message": "Invalid email",        "code": "invalid_string" },
    { "field": "age",          "message": "Number must be ≥ 18",  "code": "too_small", "minimum": 18 },
    { "field": "tags[1]",      "message": "String must not be empty", "code": "too_small" }
  ]
}
```

### 💥 Breaking Changes

Ninguno — todos los cambios son retrocompatibles. Las firmas de `createCursorPaginatedResult` tienen un nuevo parámetro opcional `hadPrevCursor` (cuarto argumento, `false` por defecto).

### 📦 Dependencias

Sin cambios en dependencias de runtime. Express sigue siendo peer dependency opcional.

---

## [0.3.3] - 2025-10-31

### 🐛 Critical Bug Fixes
- **JSON Response Serialization**: Fixed critical bug where JSON responses were not being serialized correctly
- **CLI Version Resolution**: Confirmed CLI correctly fetches and uses latest npm version (0.3.2)
- **Application Compilation**: Fixed missing `await app.compile()` call in generated templates

### 🔧 CLI Improvements
- **Version Fetching**: CLI now correctly fetches latest version from npm registry
- **Template Generation**: All templates now include proper `await app.compile()` call
- **Error Handling**: Improved error handling in CLI operations

## [0.3.2] - 2025-10-31

## [0.3.1] - 2025-10-31

### 🛠️ CLI Improvements

#### Enhanced Project Generation
- **Latest Version Fetching**: CLI now automatically fetches the latest VeloceTS version from npm registry
- **Improved Error Handling**: Better error messages and cleanup on project creation failure
- **Type Safety**: Fixed TypeScript errors in CLI with proper type definitions for npm registry API
- **Better User Experience**: Enhanced progress messages and visual feedback during project creation
- **Robust Fallbacks**: Multiple fallback strategies for version detection when npm is unavailable

#### Fixed Issues
- **npm Registry Integration**: Fixed CLI to use correct npm registry endpoint (`/veloce-ts` instead of `/veloce-ts/latest`)
- **Type Definitions**: Added proper TypeScript interfaces for npm registry response structure
- **Version Resolution**: Improved version parsing with proper type checking and validation
- **Package.json Generation**: Now uses specific dependency versions instead of 'latest' for better stability
- **Template Compilation**: All generated templates now include mandatory `await app.compile()` call

#### Technical Improvements
- **NpmRegistryResponse Interface**: Added proper typing for npm registry API responses
- **Async Error Handling**: Better error handling in async CLI operations
- **Dependency Versions**: Updated to use specific versions for better reproducibility:
  - `hono: ^4.0.0` (instead of 'latest')
  - `reflect-metadata: ^0.2.0` (instead of 'latest')
  - `zod: ^3.22.0` (instead of 'latest')
  - `typescript: ^5.3.0` (instead of 'latest')
- **Engine Requirements**: Added Node.js and Bun version requirements to generated package.json

#### Developer Experience
- **Progress Indicators**: Added emoji-based progress indicators for better visual feedback
- **Cleanup on Failure**: Automatic cleanup of partial projects when creation fails
- **Validation**: Better project name validation and error messages
- **Documentation**: Generated projects include comprehensive setup instructions

### 🐛 Bug Fixes
- **CLI TypeScript Errors**: Fixed 'data is of type unknown' error in npm registry API calls
- **Template Generation**: Fixed missing `await app.compile()` in all CLI templates
- **Dependency Management**: Improved dependency version resolution and fallback handling

### 📦 Migration Guide

#### For CLI Users
No breaking changes. Existing projects will continue to work. New projects generated with `veloce-ts new` will:
- Use the latest VeloceTS version automatically
- Include proper `await app.compile()` calls
- Have more stable dependency versions

#### For Framework Users
No changes required. This release only improves the CLI experience.

## [0.3.0] - 2025-10-29

### 🚀 Major Features Added

#### Response Caching System
- **In-Memory Cache Store**: Fast LRU-based caching with automatic cleanup
- **Redis Cache Store**: Distributed caching support for multi-instance deployments
- **@Cache() Decorator**: Declarative response caching with flexible TTL configuration
- **@CacheInvalidate() Decorator**: Pattern-based cache invalidation for mutations
- **Cache Middleware**: Functional API support for route-level caching
- **TTL Support**: Flexible time-to-live with string format ('5m', '1h', '1d') or seconds
- **Pattern Invalidation**: Wildcard pattern matching for cache invalidation ('products:*')
- **Cache Keys**: Smart key generation with placeholder support ('product:{id}')
- **Cache Headers**: Automatic X-Cache headers (HIT/MISS) in responses

#### Enhanced Request Context
- **Automatic Request IDs**: UUID generation for every request
- **@RequestId() Decorator**: Inject request ID into controller methods
- **@AbortSignal() Decorator**: Request cancellation support for long-running operations
- **Request Timeouts**: Configurable timeouts per route or globally
- **Logging Integration**: Request ID automatically propagates through all logs
- **Response Headers**: X-Request-ID header in all responses
- **Metadata Storage**: Attach custom data to request context
- **Request Lifecycle**: Automatic logging of request start/end with duration

#### Logging Improvements
- **Request Context Integration**: Automatic request ID in all log entries
- **Child Loggers**: Enhanced contextual logging with inheritance
- **Structured Logging**: JSON-formatted logs for production
- **Pretty Printing**: Human-readable logs for development
- **Log Middleware**: Request lifecycle logging with configurable headers

### 🎯 New Decorators

- **@Cache(options)**: Cache route responses with TTL and key configuration
- **@CacheInvalidate(pattern)**: Invalidate cache entries matching patterns
- **@RequestId()**: Inject unique request ID into handler parameters
- **@AbortSignal()**: Inject AbortSignal for request cancellation

### 🔧 New Middleware

- **createRequestContextMiddleware()**: Initialize request context with ID, timeout, and logging
- **createSimpleRequestIdMiddleware()**: Minimal request ID middleware
- **createCacheMiddleware()**: Functional API route caching
- **createCacheInvalidationMiddleware()**: Functional API cache invalidation

### 📦 New Modules

- **src/cache/**: Complete caching system
  - `types.ts`: Cache interfaces and types
  - `memory-store.ts`: In-memory LRU cache implementation
  - `redis-store.ts`: Redis backend for distributed caching
  - `manager.ts`: Global cache management and utilities
- **src/context/**: Enhanced request context
  - `request-context.ts`: Request tracking with UUID and AbortSignal
- **src/middleware/**: New middleware
  - `request-context.ts`: Request context initialization
  - `cache.ts`: Cache middleware for functional API
- **src/decorators/**: New decorators
  - `cache.ts`: @Cache and @CacheInvalidate decorators

### 🛠️ Core Improvements

- **Router Compiler**: Integrated cache checking and invalidation in route handlers
- **Type System**: New parameter types for request-id and abort-signal
- **Export System**: All new decorators and middleware properly exported
- **Error Handling**: Improved error handling with request ID context

### 📚 Documentation

#### New Guides (English + Spanish)
- **Caching Guide**: Complete guide to response caching (15,000 words total)
  - In-memory and Redis stores
  - Decorators and middleware
  - TTL configuration
  - Cache invalidation strategies
  - Best practices with 50+ code examples
- **Request Context Guide**: Request tracking and management (12,000 words total)
  - Automatic UUID generation
  - Request cancellation with AbortSignal
  - Timeout configuration
  - Logging integration
  - 40+ code examples
- **Logging Guide**: Structured logging with Pino (4,000 words total)
  - Logger configuration
  - Child loggers
  - Request ID integration
  - Best practices

#### Documentation Coverage
- Added 31,000+ words of professional documentation
- 100+ new code examples
- Bilingual support (English and Spanish)
- SEO-optimized with meta descriptions
- Cross-referenced between guides

### 🌐 Sidebar Updates

Updated Starlight documentation sidebar with new guides:
- Caching
- Request Context
- Logging

### ⚡ Performance Improvements

- **Cache System**: Sub-millisecond cache hits with in-memory store
- **LRU Eviction**: Automatic memory management in cache store
- **Request Context**: Minimal overhead UUID generation
- **Logging**: Efficient structured logging with Pino

### 🔄 API Additions

#### Cache Manager
```typescript
- CacheManager.setDefaultStore(store)
- CacheManager.getDefaultStore()
- CacheManager.generateKey(method, path, params, query, options)
- CacheManager.get(key, store?)
- CacheManager.set(key, value, ttl?, store?)
- CacheManager.delete(key, store?)
- CacheManager.invalidate(pattern, store?)
- CacheManager.clear(store?)
```

#### Helper Functions
```typescript
- getCache<T>(key): Promise<T | null>
- setCache<T>(key, value, ttl?): Promise<void>
- deleteCache(key): Promise<boolean>
- invalidateCache(pattern): Promise<number>
- clearCache(): Promise<void>
- getRequestId(context): string | null
- getAbortSignal(context): AbortSignal | null
- setRequestMetadata(context, key, value): void
- getRequestMetadata(context, key): any
- generateRequestId(): string
```

### 🐛 Bug Fixes

- **ORM Exports**: Fixed DrizzleTransactionManager import path
- **Middleware Exports**: Added missing createCacheInvalidationMiddleware export
- **Request Context**: Fixed AbortController reference in context

### 💥 Breaking Changes

None - All changes are additive and backward compatible

### 📦 Dependencies

No new runtime dependencies added. Caching works with existing dependencies:
- In-memory cache: No dependencies (built-in)
- Redis cache: Requires `redis` or `ioredis` (peer dependency)

### 🎯 Migration Guide

#### Adding Cache to Existing Routes

```typescript
// Before
@Get('/products')
async getProducts() {
  return await db.products.findAll();
}

// After - Add caching
@Get('/products')
@Cache({ ttl: '5m', key: 'products:list' })
async getProducts() {
  return await db.products.findAll();
}
```

#### Adding Request Tracking

```typescript
// Add to app initialization
import { createRequestContextMiddleware } from 'veloce-ts';

app.use(createRequestContextMiddleware({
  timeout: 30000,
  logging: true
}));

// Use in controllers
@Get('/data')
async getData(@RequestId() requestId: string) {
  logger.info({ requestId }, 'Processing request');
  return data;
}
```

### 📊 Statistics

- **New Files**: 15+ new source files
- **Documentation**: 31,000+ words
- **Code Examples**: 100+ examples
- **Test Coverage**: All new features covered
- **Languages**: Full bilingual support (EN/ES)

### 🙏 Acknowledgments

This release brings powerful performance optimization features to Veloce-TS:
- Response caching reduces database load and improves response times
- Request tracking enables better debugging and monitoring
- Enhanced logging provides better observability in production

## [0.2.6] - 2025-10-15

### Fixed
- **Query Export**: Added missing `Query` export from main index to resolve import conflicts
- **Parameter Decorators**: HTTP `@Query` decorator now properly exported alongside GraphQL decorators
- **Import Resolution**: Fixed "Export named 'Query' not found" error in applications

## [0.2.5] - 2025-10-15

### Fixed
- **GraphQL Query Conflict**: Removed conflicting alias `Query` from GraphQL decorators
- **Import Resolution**: GraphQL decorators now use `GQLQuery` to avoid conflicts with HTTP `@Query` decorator
- **Type Safety**: Eliminated TypeScript errors caused by decorator name conflicts

### Breaking Changes
- GraphQL queries now use `@GQLQuery` instead of `@Query` to avoid conflicts with HTTP parameter decorator

## [0.2.4] - 2025-10-15

### Fixed
- **Query Decorator**: Fixed `@Query` decorator to properly handle parameters without schemas
- **Query Parameter Extraction**: Improved query parameter handling in router compiler
- **Validation**: Added proper validation for query parameters with optional Zod schemas
- **Error Handling**: Fixed missing `ValidationError` import, now using `BadRequestException`

### Improved
- **Query Decorator Flexibility**: `@Query` now supports multiple usage patterns:
  - `@Query()` - Extract all query parameters
  - `@Query('param')` - Extract specific parameter
  - `@Query(Schema)` - Validate with Zod schema
- **Router Compiler**: Enhanced parameter extraction and validation logic
- **Type Safety**: Better TypeScript support for query parameter handling

### Breaking Changes
- None

## [0.2.3] - 2025-10-14

### Fixed
- **WebSocket Exports**: Fixed missing `WebSocket` decorator export from WebSocket module
- **Import Resolution**: WebSocket decorators now properly exported from `veloce-ts/websocket`

## [0.2.2] - 2025-10-14

### Fixed
- **GraphQL Decorators**: Added missing `Query`, `Mutation`, and `Subscription` aliases for GraphQL decorators
- **Import Conflicts**: Fixed naming conflicts between params and GraphQL decorators
- **CLI Templates**: Fixed import errors in CLI template generation
- **Package Version**: CLI now uses current package version when generating new projects

### Changed
- **GraphQL Exports**: GraphQL decorators now available with intuitive names (`Query`, `Mutation`, `Subscription`)
- **Import Resolution**: Cleaner import structure to avoid naming conflicts

## [0.2.1] - 2025-10-14

### Fixed
- **GraphQL Exports**: Fixed missing `Arg` decorator export from GraphQL module
- **Import Resolution**: GraphQL decorators now properly exported from `veloce-ts/graphql`
- **Type Definitions**: GraphQL decorators included in TypeScript declarations

## [0.2.0] - 2025-10-14

### 🚀 Major Features Added
- **Complete Authentication System**: JWT-based authentication with access/refresh tokens
- **Role-Based Access Control (RBAC)**: Hierarchical roles with granular permissions system
- **SQLite Integration**: Built-in SQLite support with Bun's native database
- **Real-time WebSocket Support**: Enhanced WebSocket handling with decorators
- **GraphQL Integration**: Complete GraphQL support with resolvers and subscriptions
- **Advanced Middleware System**: Custom middleware with request/response interceptors
- **Admin Panel Features**: Comprehensive admin endpoints for user and system management

### 🎯 New Decorators & Features
- **@Auth**: JWT authentication decorator with automatic user injection
- **@CurrentUser**: Inject current authenticated user into handlers
- **@MinimumRole**: Role-based endpoint protection
- **@Permissions**: Granular permission-based access control
- **@WebSocket**: Enhanced WebSocket decorators with connection management
- **@Resolver**: GraphQL resolver decorators for queries and mutations
- **@OnConnect/@OnMessage/@OnDisconnect**: WebSocket lifecycle decorators

### 🔧 Core Framework Improvements
- **Router Compiler Fixes**: Fixed critical bugs with sparse array handling in metadata
- **Dependency Injection**: Enhanced DI system with better error handling
- **Parameter Resolution**: Improved parameter and dependency resolution
- **Type Safety**: Enhanced TypeScript inference and type checking
- **Error Handling**: Better error messages and debugging capabilities

### 📚 Documentation & Examples
- **Veloce TaskMaster**: Complete real-world example with authentication, RBAC, and frontend
- **Comprehensive Examples**: Task management system showcasing all framework features
- **Migration Guides**: Documentation for migrating from Express.js and other frameworks
- **API Documentation**: Enhanced OpenAPI/Swagger documentation generation

### 🛠️ Technical Improvements
- **Performance**: Optimized router compilation and metadata handling
- **Memory Management**: Better handling of metadata arrays and object references
- **Bundle Size**: Reduced framework bundle size through optimizations
- **Build System**: Improved TypeScript compilation and type generation
- **Testing**: Enhanced testing utilities and error reporting

### 🔒 Security Enhancements
- **JWT Security**: Secure token generation and validation
- **Password Hashing**: Built-in password hashing utilities
- **CSRF Protection**: Enhanced CORS and security middleware
- **Input Validation**: Improved Zod schema validation
- **Role Hierarchy**: Configurable role hierarchy with permission inheritance

### 🎨 Developer Experience
- **Better Error Messages**: More descriptive error messages with stack traces
- **Hot Reload**: Improved development server with better file watching
- **TypeScript Support**: Enhanced type inference and IntelliSense
- **Debugging**: Better debugging capabilities with request tracing
- **CLI Improvements**: Enhanced CLI with better project scaffolding

### 🐛 Critical Bug Fixes
- **Router Compilation**: Fixed sparse array handling in parameter metadata
- **Dependency Resolution**: Fixed undefined dependency handling
- **Array Length Errors**: Fixed array creation with invalid indices
- **Import Path Issues**: Corrected all import paths in generated projects
- **Metadata Processing**: Fixed metadata compilation edge cases

### 📦 New Dependencies
- **jsonwebtoken**: JWT token generation and validation
- **reflect-metadata**: Enhanced reflection capabilities for decorators
- **zod-to-json-schema**: Improved OpenAPI schema generation

## [0.1.7] - 2025-10-12

### Fixed
- Fixed syntax error in CLI new command that prevented build from completing
- Fixed README generation in CLI templates

## [0.1.6] - 2025-10-12

### Added
- **Landing Page**: Created modern Astro-based website with interactive terminal and file explorer
- **Interactive Terminal**: Built terminal component for API testing with command history
- **File Explorer**: Developed code browser with hierarchical navigation for demo app
- **Documentation Files**: CLI now generates README.md and API_DOCUMENTATION.md in new projects

### Changed
- **Complete Rebranding**: Renamed framework from FastAPI-TS to Veloce-TS throughout codebase
- **OpenAPIPlugin**: Now serves Swagger UI directly from code (no need for static HTML files)
- **Improved Swagger UI**: Updated to version 5.9.0 with better styling and functionality
- **Simplified Templates**: `veloce-ts new` command no longer generates unnecessary public files
- **Better Defaults**: OpenAPI documentation now uses "Veloce-TS" branding by default
- **Updated URLs**: All references now point to correct GitHub repository and documentation

### Fixed
- Fixed Swagger UI rendering issues with proper script loading
- Fixed OpenAPI plugin to correctly serve HTML responses and return proper content types
- Fixed broken links and outdated branding throughout codebase
- Improved CORS handling in generated templates
- Fixed CLI template generation to include proper documentation structure

## [0.1.5] - 2025-10-12

### Fixed
- Fixed CLI templates to include OpenAPIPlugin automatically when docs: true
- REST and Fullstack templates now properly initialize OpenAPI documentation

## [0.1.4] - 2025-10-13

### Fixed
- Fixed CLI templates to call `await app.compile()` before `app.listen()`
- This fixes the 404 error on all routes in generated projects

## [0.1.3] - 2025-10-12

### Fixed
- Fixed package.json main and exports paths to point to correct dist/*/src/ directories
- This fixes the "Cannot find package" error when importing veloce-ts

## [0.1.2] - 2025-10-12

### Fixed
- Fixed CLI templates to use correct package name `veloce-ts` instead of `VeloceTS`
- Fixed all import statements in generated projects

## [0.1.1] - 2025-10-12

### Fixed
- Fixed CLI binary path to use compiled dist files instead of source files

## [0.1.0] - 2025-10-12

### Added
- Initial release of veloce-ts framework
- Decorator-based routing with @Controller, @Get, @Post, @Put, @Delete, @Patch
- Functional API for decorator-free routing
- Automatic request validation with Zod schemas
- Dependency injection system with singleton, request, and transient scopes
- Automatic OpenAPI documentation generation
- Response handling with JSONResponse, HTMLResponse, FileResponse, StreamResponse, RedirectResponse
- Plugin system for extensibility
- WebSocket support with decorators
- GraphQL support with decorators
- CLI tool for project scaffolding and development
- Middleware system with CORS, rate limiting, and compression
- Error handling with custom exceptions
- Testing utilities with TestClient
- Multi-runtime support (Bun, Node.js, Deno, Cloudflare Workers)
- Adapter system for Express and Hono
- Type safety with full TypeScript support
- Performance optimizations with metadata compilation and schema caching

## [0.1.0] - 2025-10-12

### Added
- Initial development version
- Core framework architecture
- Basic routing and validation
- Documentation generation
- Plugin system
- WebSocket and GraphQL support
- CLI tooling
- Testing utilities

[Unreleased]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/AlfredoMejia3001/veloce-ts/releases/tag/v0.3.3
[0.3.2]: https://github.com/AlfredoMejia3001/veloce-ts/releases/tag/v0.3.2
[0.3.1]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.3.0...v0.3.1
[0.2.2]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.7...v0.2.0
[0.1.7]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AlfredoMejia3001/veloce-ts/releases/tag/v0.1.0
