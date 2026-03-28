# chat-api

API de chat con **SQLite**, **JWT**, **salas (rooms)** y **WebSocket en tiempo real** sobre Bun.

## Arranque

```bash
bun install
bun run dev
```

- HTTP: `http://localhost:3002`
- OpenAPI: `http://localhost:3002/docs`
- WebSocket: `ws://localhost:3002/ws/chat?token=<accessToken>`

> El WebSocket **solo** se actualiza correctamente con `bun run dev` / `Bun.serve`. Los tests HTTP usan `fetch()` sin upgrade y reciben `426` / `401` / `501` según el caso.

## Probar desde el móvil (misma Wi‑Fi que el PC)

Sí: PC y teléfono en la **misma red** (mismo router).

1. Arranca `bun run dev`. El servidor usa **`HOST=0.0.0.0`** por defecto para escuchar en todas las interfaces.
2. En el PC, mira en consola las líneas **`HTTP (LAN): http://192.168.x.x:3002`** (o ejecuta `ipconfig` y usa tu IPv4).
3. En el **frontend**, la API y el WebSocket **no pueden ser `localhost` en el móvil** (localhost sería el propio teléfono). Usa la IP del PC, por ejemplo:
   - API: `http://192.168.1.40:3002`
   - WS: `ws://192.168.1.40:3002/ws/chat?token=...`
4. Si no carga: en Windows, permite **Bun** o el puerto **3002** en el firewall de red privada.

Opcional: `HOST=127.0.0.1 bun run dev` si solo quieres acceso desde la misma máquina.

## Flujo recomendado

1. `POST /auth/register` o `POST /auth/login` → guarda el `accessToken`.
2. `POST /rooms` (con `Authorization: Bearer …`) → crea sala, obtén `id`.
3. Conecta el WebSocket con ese token en query.
4. Envía mensajes JSON por el socket (ver protocolo abajo).
5. El historial también está en `GET /rooms/:id/messages` (REST).

## Protocolo WebSocket

Tras conectar, el servidor envía:

```json
{ "type": "ready", "userId": "…", "username": "…", "hint": "…" }
```

### Unirse a una sala (mismo `roomId` que en REST)

```json
{ "type": "join", "roomId": "<uuid-de-la-sala>" }
```

Respuesta al cliente que se une:

```json
{
  "type": "joined",
  "roomId": "<uuid>",
  "messages": [ { "id", "content", "room_id", "user_id", "created_at", "username" }, … ]
}
```

Los **demás** clientes en la sala reciben:

```json
{ "type": "presence", "event": "join", "roomId", "userId", "username" }
```

### Enviar mensaje (persistido en SQLite y broadcast a la sala)

```json
{ "type": "message", "roomId": "<uuid>", "content": "Hola" }
```

Todos los clientes en la sala (incluido el emisor) reciben:

```json
{ "type": "message", "id", "content", "room_id", "user_id", "created_at", "username" }
```

### Salir de la sala (opcional)

```json
{ "type": "leave", "roomId": "<uuid>" }
```

## Seguridad

- El **usuario** del socket sale del **JWT** verificado en el upgrade; no se confía en un `username` enviado en cada mensaje.
- Cualquier usuario autenticado puede unirse por WS a cualquier sala que exista (alineado con las rutas REST actuales).

## Tests

```bash
bun test
```

Requiere dependencia `veloce-ts` resoluble (por ejemplo `link:` o `file:` al paquete del monorepo).

## Estructura

```
src/
  index.ts                 # createApp + Bun.serve con upgrade JWT
  db.ts
  middleware/auth.ts
  controllers/
  ws/chat-handlers.ts      # Salas en memoria + persistencia de mensajes
```

---

Built with Veloce-TS
