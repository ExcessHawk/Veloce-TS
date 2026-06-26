# Veloce-TS · Análisis Profundo del Framework

> Versión analizada: **v0.4.18** · Fecha: 2026-06-25  
> Archivos fuente: ~40 `.ts` · Runtime: Bun ≥1.0 / Node ≥18

---

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Ciclo de vida de una petición](#2-ciclo-de-vida-de-una-petición)
3. [Análisis módulo por módulo](#3-análisis-módulo-por-módulo)
4. [Bugs e issues encontrados](#4-bugs-e-issues-encontrados)
5. [Fortalezas](#5-fortalezas)
6. [Recomendaciones](#6-recomendaciones)

---

## 1. Arquitectura general

Veloce-TS es una capa de orquestación delgada sobre **Hono.js**. El framework controla el sistema de decoradores, el registro de metadatos, el contenedor DI, el pipeline de compilación y el ciclo de vida de plugins. Todo lo HTTP se delega a Hono en tiempo de compilación.

### Dos APIs de primera clase — mismo pipeline de runtime

```
Decoradores (NestJS-style)          Funcional (FastAPI/Express-style)
─────────────────────────           ──────────────────────────────────
@Controller('/users')               app.get('/users/:id', {
class UserController {                handler: async (c) => { … },
  @Get('/:id')                        schema: { params: z.object(…) }
  getUser(@Param('id') id: string)  });
  { … }
}
app.include(UserController);
```

Ambas estilos compilan a través de `RouterCompiler` → las mismas features (cache, validación, DI, manejo de errores) disponibles en los dos.

### Mapa de módulos

| Módulo | Archivos clave | Responsabilidad |
|--------|---------------|-----------------|
| **Core** | `application.ts`, `metadata.ts`, `router-compiler.ts`, `compiled-metadata.ts` | Arranque, registro, compilación |
| **DI** | `dependencies/container.ts` | Tres scopes: singleton, request, transient |
| **Auth** | `auth/jwt-provider.ts`, `auth-service.ts`, `rbac.ts`, `session.ts` | JWT, refresh tokens, RBAC, OAuth, sesiones |
| **Errors** | `errors/handler.ts`, `problem-details.ts` | RFC 9457, mapeo SQL → HTTP |
| **ORM** | `orm/drizzle/`, `orm/prisma/`, `orm/typeorm/`, `base-repository.ts` | 3 adaptadores, repositorio base, transacciones |
| **Cache** | `cache/manager.ts`, `memory-store.ts`, `redis-store.ts` | Memory + Redis, `@Cache`, `@CacheInvalidate` |
| **WebSocket** | `websocket/plugin.ts`, `connection.ts` | Gateways con `@OnConnect`, `@OnMessage`, `@OnDisconnect` |
| **GraphQL** | `graphql/plugin.ts`, `schema-builder.ts` | `@Resolver`, `@Query`, `@Mutation`, `@Subscription` |
| **Middleware** | `middleware/cors.ts`, `rate-limit.ts`, `compression.ts` | CORS, rate limit, compresión global y por ruta |
| **Docs** | `docs/openapi-generator.ts` | OpenAPI spec desde metadatos + Zod schemas |
| **CLI** | `cli/commands/` | `new`, `dev`, `build`, `generate` |

---

## 2. Ciclo de vida de una petición

```
Petición HTTP
     │
     ▼
Hono (global middleware: CORS, rate-limit, compresión)
     │
     ▼
Middleware de ruta (guard RBAC, @Timeout, @RateLimit por ruta)
     │
     ▼
RouterCompiler.createHandler()
     │
     ├─ ¿Cache HIT? ──YES──► X-Cache: HIT → serializar respuesta
     │
     ▼ MISS
Extraer parámetros (body / query / param / header / cookie / tipos especiales)
     │
     ▼
Resolver dependencias (DIContainer)
     │
     ▼
Ejecutar handler
  ├── Ruta decorador: new Controller() → método
  └── Ruta funcional: handler(c, ...args)
     │
     ▼
@ResponseSchema → parse/strip con Zod
     │
     ▼
@HttpCode → aplicar status code
     │
     ▼
Guardar en cache (si aplica)
     │
     ▼
Invalidar patrones de cache (si @CacheInvalidate)
     │
     ▼
ResponseSerializer.serialize()
     │
     ▼
Respuesta HTTP

     ↕ (en cualquier punto de error)

ErrorHandler.handle()
  ├── ValidationException   → 422 + detalle de campos
  ├── HTTPException         → código específico (401, 403, 404…)
  ├── SQL SQLSTATE 22P02/22003/22007/22008 → 400
  └── Error genérico        → 500 (+ stack trace en dev)
     │
     ▼
RFC 9457 Problem Details (application/problem+json)
+ mergeVeloceCorsHeaders() ← SIEMPRE, incluso en errores
```

### Pre-compilación al arranque

Antes de la primera petición, `MetadataCompiler.compileAll()` pre-procesa cada ruta registrada:

- Compila regex de path (`:param` → named capture groups)
- Ordena índices de parámetros y dependencias
- Calcula `maxArgumentIndex` para pre-alocar arrays
- Computa flags booleanos: `hasBody`, `hasQuery`, `hasParams`, `hasHeaders`, `hasCookies`, `hasDependencies`
- Cachea todo con una clave de snapshot (JSON hash de la metadata) — compatible con hot-reload y re-registro en tests

---

## 3. Análisis módulo por módulo

### 3.1 `core/application.ts` — `VeloceTS`

Orquesta todo: instancia Hono, `MetadataRegistry`, `DIContainer`, `RouterCompiler`, `PluginManager`.

**Puntos clave:**
- `include(Controller)` extrae metadata de decoradores y registra rutas
- API funcional: `app.get/post/put/delete/patch(path, config)`
- `group(prefix, fn)` — agrupa rutas con prefijo común
- `compile()` → instala plugins en orden → `RouterCompiler.compile()`
- `listen()` → compila si no compilado → crea adaptador → graceful shutdown (SIGTERM/SIGINT, registrado una sola vez)

**Adaptadores disponibles:** `hono` (default), `express`, `native` (fallback a hono)

---

### 3.2 `core/metadata.ts` — `MetadataRegistry`

Almacén central de toda la metadata generada por decoradores.

- Usa `reflect-metadata` con claves `Symbol` (no strings — evita colisiones)
- **Métodos estáticos**: usados por decoradores en tiempo de definición de clase
- **Mapas de instancia**: usados por `RouterCompiler` en tiempo de compilación
- Gestiona 14 tipos de metadata: rutas, controllers, parámetros, dependencias, WebSocket, GraphQL, auth, OAuth, roles, permisos, minimum-role, resource-permission, session, CSRF
- `defineRoute()` hace merge de arrays (middleware, parámetros) en lugar de reemplazar — crucial para que múltiples decoradores en el mismo método cooperen

---

### 3.3 `core/compiled-metadata.ts` — `MetadataCompiler`

Pre-compilación de metadata para performance óptima en runtime.

```typescript
interface CompiledRouteMetadata extends RouteMetadata {
  pathRegex?: RegExp;
  parameterOrder: number[];    // índices ordenados
  dependencyOrder: number[];
  maxArgumentIndex: number;    // para new Array(n)
  hasBody: boolean;            // flags de tipo rápido
  hasQuery: boolean;
  hasParams: boolean;
  hasHeaders: boolean;
  hasCookies: boolean;
  hasDependencies: boolean;
}
```

**Cache con dos niveles:**
1. Clave: `ControllerName:methodName`
2. Snapshot: JSON hash de method/path/params/deps/handler-id/middleware-ids

Los handlers y middleware se identifican por un WeakMap de IDs enteros — dos funciones con el mismo texto fuente producen snapshots distintos. Esto garantiza que re-registrar una ruta con un guard RBAC nuevo invalide el cache correctamente.

---

### 3.4 `dependencies/container.ts` — `DIContainer`

Contenedor DI con tres scopes:

| Scope | Storage | Duración |
|-------|---------|----------|
| `singleton` | `Map<Provider, instance>` | Vida del proceso |
| `request` | `WeakMap<Context, Map<Provider, instance>>` | Vida del request (GC automático) |
| `transient` | Sin cache | Nuevo en cada resolución |

**Detección de dependencias circulares:**
```
resolutionStack: Set<Provider>
  → si provider ya está en el stack al intentar crearlo → throw
  → finally siempre elimina del stack
```

**Constructor injection:** Lee metadata de `'constructor'` en `MetadataRegistry.getDependencyMetadata()`. Funciona cuando el controller tiene dependencias declaradas con `@Inject` en el constructor.

**Stats de diagnóstico:** `singletonHits`, `singletonMisses`, `requestHits`, `requestMisses`, `transientCreations` — accesibles con `container.getStats()`.

---

### 3.5 `auth/` — Sistema de autenticación completo

#### JWT Provider (`jwt-provider.ts`)
- Genera par access + refresh token
- Verifica con `jsonwebtoken`, soporta HS256/384/512 y RS256/384/512
- Blacklist en memoria (`Set<string>`) con limpieza automática al agregar tokens
- `refreshAccessToken()` invalida el refresh token usado y emite un nuevo par

#### Auth Service (`auth-service.ts`)
- Interface `UserProvider` → pluggable (cualquier fuente de usuarios)
- `login()`, `register()`, `logout()`, `verifyToken()`, `refresh()`
- `InMemoryUserProvider` incluido para dev/testing

#### RBAC (`rbac.ts`, `rbac-plugin.ts`, `rbac-decorators.ts`)
- `@Roles(['admin', 'editor'])` — requiere alguno/todos
- `@Permissions(['posts:write'])` — granular
- `@MinimumRole('editor')` — jerarquía definida por el usuario
- `@CanAccess({ action: 'read', resource: 'Post' })` — permisos de recurso

#### OAuth (`oauth-plugin.ts`, `oauth-decorators.ts`)
- Pluggable por proveedor
- `@OAuthUser` y `@OAuthToken` extraen datos del contexto

#### Session (`session.ts`, `session-decorators.ts`)
- Sesiones basadas en cookies
- `@Session`, `@CurrentSession`, `@CSRFToken`, `@RequireCSRF`
- `SessionGuard` middleware incluido

---

### 3.6 `errors/` — Manejo de errores

**RFC 9457 Problem Details** (default) o formato legacy `{ error, statusCode }`:

```json
{
  "type": "https://example.com/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "User with id '123' not found",
  "instance": "/api/users/123"
}
```

**Mapeo SQL SQLSTATE → 400:**

| SQLSTATE | Descripción | HTTP |
|----------|-------------|------|
| `22P02` | invalid_text_representation (UUID/int malformado) | 400 |
| `22003` | numeric_value_out_of_range | 400 |
| `22007` | invalid_datetime_format | 400 |
| `22008` | datetime_field_overflow | 400 |

Estos son errores de input del cliente que llegan al driver de DB — mapearlos a 400 en lugar de 500 es correcto y evita que detalles del driver se filtren.

**CORS en errores:** `mergeVeloceCorsHeaders()` se llama en *todos* los caminos de `ErrorHandler.handle()`. Sin esto, un 401 o 422 aparece al navegador como error de red, no de aplicación.

---

### 3.7 `orm/` — Capa de datos

**`BaseRepository<T, ID>`** — abstract base con CRUD completo:

```typescript
interface IBaseRepository<T, ID> {
  create(data: Partial<T>): Promise<T>
  findById(id: ID): Promise<T | null>
  findOne(options: FindOptions): Promise<T | null>
  findMany(options?: FindOptions): Promise<T[]>
  update(id: ID, data: Partial<T>): Promise<T>
  delete(id: ID): Promise<boolean>
  createMany(data: Partial<T>[]): Promise<T[]>
  updateMany(where, data): Promise<number>
  deleteMany(where): Promise<number>
  findPaginated(options): Promise<PaginatedResult<T>>
  count(where?): Promise<number>
  exists(where): Promise<boolean>
  withTransaction<R>(cb): Promise<R>
}
```

**Tres adaptadores:** Drizzle ORM, Prisma, TypeORM — cada uno con su plugin, repository concreto, y transaction manager.

**Propagación de transacciones** (estilo Spring):
- `REQUIRED` — usa tx existente o crea nueva
- `REQUIRES_NEW` — siempre nueva tx
- `NESTED` — savepoint dentro de tx existente

---

### 3.8 `cache/` — Sistema de caché

Decoradores:
```typescript
@Cache({ ttl: '5m', key: 'user:{id}', includeQuery: true })
@CacheInvalidate(['/users/{id}', '/users'])
```

**`CacheManager`** static con:
- Store default: `MemoryCacheStore`
- Stores nombrados: `CacheManager.registerStore('redis', redisStore)`
- Generación de clave: method + path + params + query (ordenados)
- Header `X-Cache: HIT | MISS`

**Lazy import** — `CacheManager` se importa dinámicamente dentro del handler solo cuando la ruta tiene cache habilitado. Evita que el módulo de cache se cargue para rutas sin cache.

---

## 4. Bugs e issues encontrados

### 🔴 HIGH — `require()` en paquete ESM

**Archivo:** `core/application.ts` · `createAdapter()` · líneas 638–659

El paquete declara `"type": "module"` pero `createAdapter()` usa `require()` síncrono:

```typescript
// ❌ ACTUAL — falla en runtimes ESM nativos
const { HonoAdapter } = require('../adapters/hono');

// ✅ FIX — listen() ya es async
const { HonoAdapter } = await import('../adapters/hono.js');
```

Rompe en: Bun ESM, Node con `--input-type=module`, Deno, cualquier bundler que resuelva el entrypoint ESM. El build CJS funciona porque esos consumidores reciben `dist/cjs/` — el problema solo afecta imports ESM directos.

---

### 🔴 HIGH — `InMemoryUserProvider.hashPassword()` es Base64, no hashing

**Archivo:** `auth/auth-service.ts` · línea 203

```typescript
// ❌ ACTUAL — encoding trivialmente reversible
async hashPassword(password: string): Promise<string> {
  return Buffer.from(password).toString('base64');
}
```

No hay guard de producción. Un dev que conecte `InMemoryUserProvider` en producción por accidente expone contraseñas en equivalente a texto plano.

```typescript
// ✅ FIX
async hashPassword(password: string): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('InMemoryUserProvider no es seguro para producción. Implementa UserProvider con bcrypt.');
  }
  return Buffer.from(password).toString('base64');
}
```

---

### 🟠 MEDIUM — `config.cache` en rutas funcionales se pierde silenciosamente

**Archivo:** `core/application.ts` · `registerFunctionalRoute()` · líneas 332–344

`RouteConfig` declara `cache?: CacheMetadata` pero el objeto de metadata nunca lo incluye:

```typescript
// ❌ ACTUAL
const routeMetadata = {
  target: FunctionalRoute,
  propertyKey: `…`,
  method,
  path: fullPath,
  middleware: config.middleware || [],
  parameters: this.extractParametersFromSchema(config.schema),
  dependencies: [],
  // ← config.cache nunca se propaga
};

// ✅ FIX — agregar:
  cache: config.cache,
```

`@Cache` funciona en rutas con decoradores. La API funcional promete lo mismo pero silenciosamente no hace nada.

---

### 🟠 MEDIUM — `config.timeout` en rutas funcionales tampoco se conecta

**Archivo:** `types/index.ts` línea 156 / `core/application.ts`

`RouteConfig.timeout?: number` existe en el tipo pero `registerFunctionalRoute()` nunca lo lee. `@Timeout(ms)` funciona en decoradores.

```typescript
// ✅ FIX en registerFunctionalRoute():
const middleware: Middleware[] = [];
if (config.timeout) {
  middleware.push(createTimeoutMiddleware(config.timeout));
}
middleware.push(...(config.middleware || []));
```

---

### 🟠 MEDIUM — `BaseRepository.count()` carga todos los registros en memoria

**Archivo:** `orm/base-repository.ts` · líneas 172–174

```typescript
// ❌ ACTUAL — O(n) en memoria y red
async count(where?: FilterOptions): Promise<number> {
  const items = await this.findMany({ where });
  return items.length;
}
```

Los tres adaptadores ORM soportan COUNT nativo (`drizzle: count()`, `prisma: count()`, `typeorm: count()`). Nada fuerza que los implementen. Una tabla con millones de registros y este default es catastrófico.

**Fix:** Declarar `count()` y `exists()` como abstractos en `IBaseRepository` — fuerza implementación eficiente en cada adaptador.

---

### 🟠 MEDIUM — `CacheManager` estático — sin aislamiento entre instancias/tests

**Archivo:** `cache/manager.ts` · líneas 13–14

```typescript
// ❌ ACTUAL — singleton de proceso
private static defaultStore: CacheStore = new MemoryCacheStore();
private static stores: Map<string, CacheStore> = new Map();
```

Dos instancias de `VeloceTS` en el mismo proceso (común en suites de test) comparten estado de cache. Test A calienta el cache, test B obtiene resultados del test A.

```typescript
// ✅ FIX — agregar:
static reset(): void {
  this.defaultStore = new MemoryCacheStore();
  this.stores.clear();
}
```

Llamar en el helper de testing: `VeloceTestClient.reset()` o similar.

---

### ⚪ LOW — `compilePathRegex()` tiene doble-escape — rama `{param}` inalcanzable

**Archivo:** `core/compiled-metadata.ts` · líneas 147–158

```typescript
// Línea 147: escapa { y } → \{ y \}
let pattern = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Línea 149: intenta convertir \{param\} a grupos nombrados
// → NUNCA SE EJECUTA porque normalizePath() ya convirtió {param} → :param
pattern = pattern.replace(/\\\{([^}]+)\\\}/g, '(?<$1>[^/]+)');

// Línea 153: maneja :param (esto SÍ funciona)
pattern = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '(?<$1>[^/]+)');
```

Impacto real: bajo — la rama `{param}` es código muerto. Pero es confuso y rompería si `compilePathRegex()` se llamara directamente con paths sin normalizar.

**Fix:** Eliminar la rama `{param}` — es inalcanzable después de `normalizePath()`.

---

### ⚪ LOW — `getRouteMethods()` no sube la cadena de prototipos

**Archivo:** `core/metadata.ts` · líneas 349–363

```typescript
// ❌ ACTUAL — solo propiedades directas del prototipo
const propertyNames = Object.getOwnPropertyNames(prototype);
```

Si un controller hereda de otro controller base con rutas decoradas, esas rutas del padre se pierden silenciosamente en el registro.

```typescript
// ✅ FIX — subir la cadena hasta Object.prototype
let proto = target.prototype;
while (proto && proto !== Object.prototype) {
  Object.getOwnPropertyNames(proto).forEach(name => {
    if (name !== 'constructor' && this.hasRouteMetadata(proto, name)) {
      methods.add(name);
    }
  });
  proto = Object.getPrototypeOf(proto);
}
```

---

### 🟣 PERF — `createMany()` hace N inserts secuenciales

**Archivo:** `orm/base-repository.ts` · líneas 104–108

```typescript
// ❌ ACTUAL — N round-trips a la DB
async createMany(data: Partial<T>[]): Promise<T[]> {
  const results: T[] = [];
  for (const item of data) {
    results.push(await this.create(item)); // secuencial
  }
  return results;
}

// ✅ MÍNIMO — paralelo (todavía N queries, pero sin bloquear)
async createMany(data: Partial<T>[]): Promise<T[]> {
  return Promise.all(data.map(item => this.create(item)));
}
// Los adaptadores concretos deben hacer bulk insert real:
// Drizzle: db.insert(table).values(data)
// Prisma:  prisma.model.createMany({ data })
// TypeORM: repo.save(data)
```

---

### 🟣 PERF — Blacklist JWT con scan O(n) en cada logout

**Archivo:** `auth/jwt-provider.ts` · `blacklistToken()` / `cleanupBlacklist()` · líneas 174–198

`blacklistToken()` llama `cleanupBlacklist()` síncronamente en cada invocación. `cleanupBlacklist()` itera todo el `Set`, decodifica cada token, verifica `exp`. En logout de alto tráfico esto se convierte en cuello de botella.

**Fix para escala:** Usar un `Map<string, number>` (token → timestamp de expiración) en lugar de un `Set`, con limpieza solo de entradas expiradas:

```typescript
private blacklistedTokens: Map<string, number> = new Map(); // token → exp timestamp

blacklistToken(token: string): void {
  const payload = this.decodeToken(token);
  const exp = payload?.exp ?? (Math.floor(Date.now() / 1000) + 3600);
  this.blacklistedTokens.set(token, exp);
}

isBlacklisted(token: string): boolean {
  const exp = this.blacklistedTokens.get(token);
  if (exp === undefined) return false;
  if (exp < Math.floor(Date.now() / 1000)) {
    this.blacklistedTokens.delete(token); // lazy cleanup
    return false;
  }
  return true;
}
```

Para producción con tráfico alto: delegar blacklist a Redis con TTL nativo.

---

## 5. Fortalezas

### Cache de compilación con snapshots

`MetadataCompiler` hashea la metadata de cada ruta (incluyendo IDs de middleware por WeakMap) para detectar cambios. Rutas re-registradas en tests invalidan el cache correctamente en lugar de servir compilaciones obsoletas. El manejo de identidad de funciones (WeakMap de enteros incrementales) es sutil pero correcto.

### RFC 9457 Problem Details completo

Implementación completa del estándar: `type`, `title`, `status`, `detail`, `instance`. El mapeo de SQLSTATE a 400 (22P02, 22003, 22007, 22008) captura input malformado del cliente que llega al driver de DB y previene que aparezca como error 500. Es un detalle sofisticado que demuestra experiencia de producción.

### CORS en todas las respuestas de error

`mergeVeloceCorsHeaders()` se invoca en todos los caminos de `ErrorHandler.handle()`. Sin esto, un 401 o 422 con CORS habilitado aparece al navegador como `net::ERR_FAILED` — un bug notoriamente difícil de diagnosticar que confunde a muchos desarrolladores.

### DI por request con WeakMap

`WeakMap<Context, Map<Provider, instance>>` para instancias con scope `request`. Cuando Hono libera el contexto, el GC libera automáticamente todas las instancias asociadas. Sin hooks de limpieza manual, sin memory leak.

### Ambas APIs comparten el mismo pipeline

Rutas con decoradores y rutas funcionales ambas compilan a través de `RouterCompiler`. Cache, validación Zod, DI, manejo de errores, y `@ResponseSchema` funcionan idénticamente en los dos estilos — no hay divergencia de features entre APIs.

### Decorador `@Timeout` bien implementado

```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  timer = setTimeout(() => reject(…), ms);
});
try {
  await Promise.race([next(), timeoutPromise]);
} finally {
  if (timer !== undefined) clearTimeout(timer); // siempre limpia
}
```

`finally` garantiza que el timer se limpie independientemente del resultado. Prepone el middleware en lugar de wrappear el handler directamente — correcto para la arquitectura.

### Ordenamiento de plugins por dependencias

`PluginManager` acepta declaraciones `dependsOn: ['DatabasePlugin']` y ordena topológicamente antes de instalar. Un auth plugin que requiere DB simplemente declara la dependencia — el orden de registro no importa.

### Arrays pre-alocados en dispatch

`maxArgumentIndex` calculado en compile-time se usa en `mergeArguments()` para `new Array(maxIndex + 1)`. Elimina crecimiento dinámico de array durante el manejo de peticiones. Pequeña optimización pero correcta.

### Tipos de inferencia ergonómicos

```typescript
type User = InferSchema<typeof UserSchema>;
type CreateBody = InferBody<typeof CreateUserSchema>;
type Handler = TypedHandler<typeof BodySchema, typeof QuerySchema>;
type Service = InferDependency<typeof UserService>;
```

Los usuarios raramente necesitan escribir `z.infer<typeof Schema>` manualmente. La superficie de la API TypeScript es limpia.

---

## 6. Recomendaciones

### Prioritarias (bugs reales)

**1. Reemplazar `require()` con `await import()` en `createAdapter()`**

`listen()` ya es `async`. Cambio de dos líneas por adaptador. Desbloquea runtimes ESM nativos y resuelve la inconsistencia con el `"type": "module"` declarado en `package.json`.

**2. Agregar guard de producción a `InMemoryUserProvider`**

Una línea al inicio de `hashPassword()`. Previene un accidente de seguridad grave con cero fricción en dev/test.

**3. Propagar `config.cache` y `config.timeout` en rutas funcionales**

Dos líneas en `registerFunctionalRoute()`. El tipo promete que funciona — hay que cumplir esa promesa.

**4. Hacer `count()` y `exists()` abstractos en `IBaseRepository`**

Fuerza a cada adaptador ORM a implementarlos eficientemente. El default actual (`findMany().length`) es peligroso a escala.

### Importantes (calidad / DX)

**5. Agregar `CacheManager.reset()` para aislamiento en tests**

Un método estático que reemplaza el store default y limpia los stores nombrados. Llamarlo en el helper de testing del framework.

**6. Subir la cadena de prototipos en `getRouteMethods()`**

Habilita herencia de controllers sin pérdida silenciosa de rutas del padre.

**7. Usar `Promise.all()` en `createMany()` como mínimo**

El default sigue siendo N queries (no bulk), pero al menos en paralelo. Los adaptadores concretos deben hacer bulk insert real.

### Ideas de features

**8. Decorador `@Transactional()`**

La infraestructura de propagación de transacciones ya existe (REQUIRED / REQUIRES_NEW / NESTED). Un decorator de método que auto-wrappee el handler en una transacción usando el transaction manager del plugin ORM activo sería de alto valor:

```typescript
@Post('/transfer')
@Transactional({ propagation: 'REQUIRED' })
async transfer(@Body(TransferSchema) body: Transfer) {
  await this.accountRepo.debit(body.from, body.amount);
  await this.accountRepo.credit(body.to, body.amount);
  // auto-rollback si cualquiera falla
}
```

**9. Blacklist JWT en Redis (opcional via plugin)**

Para deployments con alta tasa de logout o múltiples instancias, ofrecer un `JwtBlacklistPlugin` que use Redis con TTL nativo elimina el `Set` en memoria y funciona correctamente en clusters.

---

## Resumen de issues

| # | Severidad | Módulo | Issue |
|---|-----------|--------|-------|
| 1 | 🔴 HIGH | `core/application.ts` | `require()` en paquete ESM |
| 2 | 🔴 HIGH | `auth/auth-service.ts` | Base64 como "hash" sin guard de producción |
| 3 | 🟠 MEDIUM | `core/application.ts` | `config.cache` ignorado en rutas funcionales |
| 4 | 🟠 MEDIUM | `core/application.ts` | `config.timeout` ignorado en rutas funcionales |
| 5 | 🟠 MEDIUM | `orm/base-repository.ts` | `count()` carga todos los registros en memoria |
| 6 | 🟠 MEDIUM | `cache/manager.ts` | Singleton estático, sin aislamiento de tests |
| 7 | ⚪ LOW | `core/compiled-metadata.ts` | Rama `{param}` inalcanzable en `compilePathRegex()` |
| 8 | ⚪ LOW | `core/metadata.ts` | `getRouteMethods()` no sube cadena de prototipos |
| 9 | 🟣 PERF | `orm/base-repository.ts` | `createMany()` N inserts secuenciales |
| 10 | 🟣 PERF | `auth/jwt-provider.ts` | Blacklist con scan O(n) por logout |

---

*Análisis generado con lectura directa del código fuente — `src/` completo, 40 archivos TypeScript.*
