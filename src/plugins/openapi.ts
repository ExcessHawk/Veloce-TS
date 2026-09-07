// OpenAPI Plugin - Generates OpenAPI 3.1 specification and serves Swagger UI
import type { Plugin } from '../core/plugin.js';
import type { VeloceTS } from '../core/application.js';
import type { OpenAPIOptions } from '../types/index.js';
import { OpenAPIGenerator } from '../docs/index.js';

/**
 * Where Swagger UI's static assets (CSS + JS bundle) are loaded from.
 * - `'cdn'` (default): a pinned unpkg version, loaded with Subresource Integrity
 *   (SRI) hashes so the browser refuses the asset if its bytes ever change.
 * - `{ cssUrl, jsUrl }`: self-host the assets (e.g. serve them from your own
 *   static files or a vendored copy) and skip the CDN + SRI entirely.
 */
export type SwaggerUIAssets = 'cdn' | { cssUrl: string; jsUrl: string };

export interface OpenAPIPluginOptions extends OpenAPIOptions {
  /** @default 'cdn' */
  swaggerAssets?: SwaggerUIAssets;
}

// Pinned Swagger UI CDN version + SRI hashes.
// Hashes were computed from the exact published unpkg files for this version —
// see tests/openapi.test.ts for the accompanying regression check. Bumping the
// version requires recomputing these hashes against the new files.
const SWAGGER_UI_VERSION = '5.32.11';
const SWAGGER_UI_CSS_URL = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css`;
const SWAGGER_UI_BUNDLE_URL = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js`;
const SWAGGER_UI_STANDALONE_URL = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js`;
const SWAGGER_UI_CSS_INTEGRITY = 'sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT';
const SWAGGER_UI_BUNDLE_INTEGRITY = 'sha384-vfl/klfTFrIz5urj0HnhcXLAbzPdRHezizfy+XgFB6GqcKkhlk0lS3bIbyB39NLA';
const SWAGGER_UI_STANDALONE_INTEGRITY = 'sha384-m05NHMTwYzsIxuzXMYDard06UtAxQkr+gZ7tf01TGlpECbjtRVz8HSkSMCBiwMQQ';

/**
 * OpenAPIPlugin generates OpenAPI 3.1 specification from route metadata
 * and serves Swagger UI for interactive API documentation
 */
export class OpenAPIPlugin implements Plugin {
  name = 'openapi';
  version = '1.0.0';

  private options: Required<OpenAPIPluginOptions>;

  constructor(options?: OpenAPIPluginOptions) {
    this.options = {
      title: options?.title || 'Veloce-TS API',
      version: options?.version || '1.0.0',
      description: options?.description || 'API built with Veloce-TS',
      path: options?.path || '/openapi.json',
      docsPath: options?.docsPath || '/docs',
      docs: options?.docs !== false,
      swaggerAssets: options?.swaggerAssets || 'cdn'
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
        description: 'Returns the OpenAPI 3.1 specification for this API',
        tags: ['Documentation']
      }
    });

    // Always register Swagger UI at docsPath — served entirely from the backend
    // so it works in every environment without static files.
    if (this.options.docs && this.options.docsPath) {
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
   * Generate OpenAPI 3.1 specification from application metadata
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
    return this.options.swaggerAssets === 'cdn'
      ? this.renderSwaggerUICdn()
      : this.renderSwaggerUISelfHosted(this.options.swaggerAssets);
  }

  /**
   * CDN variant: pinned unpkg version with SRI hashes on every tag, so the
   * browser rejects the asset outright if the CDN ever serves different bytes.
   */
  private renderSwaggerUICdn(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.options.title} - API Documentation</title>
  <link rel="stylesheet" href="${SWAGGER_UI_CSS_URL}" integrity="${SWAGGER_UI_CSS_INTEGRITY}" crossorigin="anonymous" />
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI_BUNDLE_URL}" integrity="${SWAGGER_UI_BUNDLE_INTEGRITY}" crossorigin="anonymous"></script>
  <script src="${SWAGGER_UI_STANDALONE_URL}" integrity="${SWAGGER_UI_STANDALONE_INTEGRITY}" crossorigin="anonymous"></script>
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

  /**
   * Self-hosted variant: the caller supplies its own CSS/JS URLs (e.g. served
   * as static files from the app itself), so there is no third-party CDN
   * dependency and no SRI hash to maintain here.
   */
  private renderSwaggerUISelfHosted(assets: { cssUrl: string; jsUrl: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.options.title} - API Documentation</title>
  <link rel="stylesheet" href="${assets.cssUrl}" />
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${assets.jsUrl}"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: '${this.options.path}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        tryItOutEnabled: true,
        presets: [
          SwaggerUIBundle.presets.apis
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ]
      });
    };
  </script>
</body>
</html>`;
  }
}
