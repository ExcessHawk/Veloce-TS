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
    // Get app config to merge with plugin options
    const appConfig = app.getConfig();
    if (appConfig.title) this.options.title = appConfig.title;
    if (appConfig.version) this.options.version = appConfig.version;
    if (appConfig.description) this.options.description = appConfig.description;

    // Register OpenAPI spec endpoint
    app.get(this.options.path, {
      handler: async () => {
        const spec = this.generateSpec(app);
        return spec;
      },
      docs: {
        summary: 'Get OpenAPI specification',
        description: 'Returns the OpenAPI 3.0 specification for this API',
        tags: ['Documentation']
      }
    });

    // Note: Swagger UI HTML is served via static files (public/docs.html)
    // This is more reliable than serving HTML from the plugin
    // The OpenAPI JSON spec is available at the configured path
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
   * Render Swagger UI HTML
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
    body {
      margin: 0;
      padding: 0;
    }
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
