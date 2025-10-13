# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AlfredoMejia3001/veloce-ts/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AlfredoMejia3001/veloce-ts/releases/tag/v0.1.0
