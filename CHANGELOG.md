# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AlfredoMejia3001/veloce-ts/releases/tag/v0.1.0
