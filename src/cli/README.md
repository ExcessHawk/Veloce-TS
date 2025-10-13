# Veloce CLI

Command-line interface for Veloce framework.

## Installation

```bash
bun add -g veloce
```

## Commands

### `veloce new <name>`

Create a new Veloce project.

**Options:**
- `-t, --template <template>` - Project template (rest, graphql, websocket, fullstack) [default: rest]

**Examples:**
```bash
# Create a REST API project
veloce new my-api

# Create a GraphQL project
veloce new my-graphql-api --template graphql

# Create a WebSocket project
veloce new my-ws-api --template websocket

# Create a fullstack project with all features
veloce new my-fullstack-api --template fullstack
```

### `veloce dev`

Start development server with hot reload.

**Options:**
- `-p, --port <port>` - Port to run the server on [default: 3000]
- `-w, --watch <path>` - Additional paths to watch [default: src]

**Examples:**
```bash
# Start dev server on default port
veloce dev

# Start dev server on custom port
veloce dev --port 8000
```

### `veloce build`

Build project for production.

**Options:**
- `-m, --minify` - Minify output [default: false]
- `-s, --sourcemap` - Generate sourcemaps [default: true]
- `-o, --outdir <dir>` - Output directory [default: dist]
- `-f, --format <format>` - Output format (esm, cjs, both) [default: both]

**Examples:**
```bash
# Build with default options
veloce build

# Build with minification
veloce build --minify

# Build only ESM format
veloce build --format esm
```

### `veloce generate openapi`

Generate OpenAPI specification from your application.

**Options:**
- `-o, --output <file>` - Output file path [default: openapi.json]

**Examples:**
```bash
# Generate OpenAPI spec
veloce generate openapi

# Generate to custom file
veloce generate openapi --output api-spec.json
```

### `veloce generate client`

Generate TypeScript client from OpenAPI specification.

**Options:**
- `-i, --input <file>` - OpenAPI spec file [default: openapi.json]
- `-o, --output <dir>` - Output directory [default: src/client]

**Examples:**
```bash
# Generate client from openapi.json
veloce generate client

# Generate from custom spec file
veloce generate client --input my-spec.json --output src/api-client
```

## Project Templates

### REST Template
Basic REST API with:
- Controller-based routing
- Request validation with Zod
- Example CRUD endpoints
- OpenAPI documentation

### GraphQL Template
GraphQL API with:
- Resolver-based architecture
- Type-safe queries and mutations
- GraphQL Playground
- Zod validation for arguments

### WebSocket Template
Real-time WebSocket API with:
- WebSocket decorators
- Message validation
- Room-based broadcasting
- Connection management

### Fullstack Template
Complete application with:
- REST API endpoints
- GraphQL API
- WebSocket support
- All features enabled

## Development Workflow

1. Create a new project:
```bash
veloce new my-app
cd my-app
```

2. Install dependencies:
```bash
bun install
```

3. Start development server:
```bash
bun run dev
```

4. Build for production:
```bash
bun run build
```

5. Generate API documentation:
```bash
bun run generate:openapi
```

6. Generate TypeScript client:
```bash
bun run generate:client
```

## Environment Variables

- `NODE_ENV` - Environment mode (development, production)
- `PORT` - Server port (default: 3000)

## Requirements

- Bun >= 1.0.0
- TypeScript >= 5.0.0
