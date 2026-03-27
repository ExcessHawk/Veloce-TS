// OpenAPI Plugin - Generates OpenAPI 3.0 specification and serves Swagger UI
import type { Plugin } from '../core/plugin';
import type { VeloceTS } from '../core/application';
import type { OpenAPIOptions } from '../types';
import { OpenAPIGenerator } from '../docs';

/**
 * OpenAPIPlugin generates OpenAPI 3.0 specification from route metadata
 * and serves Swagger UI for interactive API documentation
 */
export class OpenAPIPlugin implements Plugin {
  name = 'openapi';
  version = '1.0.0';

  private options: Required<OpenAPIOptions>;

  constructor(options?: OpenAPIOptions) {
    this.options = {
      title: options?.title || 'Veloce-TS API',
      version: options?.version || '1.0.0',
      description: options?.description || 'API built with Veloce-TS',
      path: options?.path || '/openapi.json',
      docsPath: options?.docsPath || '/docs',
      docs: options?.docs !== false
    };
  }

  async install(app: VeloceTS): Promise<void> {
    // Merge app-level config into plugin options
    const appConfig = app.getConfig();
    if (appConfig.title) this.options.title = appConfig.title;
    if (appConfig.version) this.options.version = appConfig.version;
    if (appConfig.description) this.options.description = appConfig.description;

    // Register OpenAPI JSON spec endpoint
    app.get(this.options.path, {
      handler: async () => {
        return this.generateSpec(app);
      },
      docs: {
        summary: 'OpenAPI specification',
        description: 'Returns the OpenAPI 3.0 specification for this API',
        tags: ['Documentation']
      }
    });

    // Always register Swagger UI at docsPath — served entirely from the backend
    // so it works in every environment without static files.
    if (this.options.docs && this.options.docsPath) {
      const specPath = this.options.path;
      const html = this.renderSwaggerUI();

      app.get(this.options.docsPath, {
        handler: async (c: any) => {
          return new globalThis.Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        },
        docs: {
          summary: 'Swagger UI',
          description: 'Interactive API documentation',
          tags: ['Documentation']
        }
      });
    }
  }

  /**
   * Generate OpenAPI 3.0 specification from application metadata
   */
  private generateSpec(app: VeloceTS) {
    const metadata = app.getMetadata();
    const generator = new OpenAPIGenerator(metadata, this.options);
    return generator.generate();
  }

  /**
   * Render Swagger UI HTML.
   * Uses a relative URL for the spec so it works on any host/port/proxy.
   */
  private renderSwaggerUI(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.options.title} - API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: '${this.options.path}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        tryItOutEnabled: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;
  }
}
