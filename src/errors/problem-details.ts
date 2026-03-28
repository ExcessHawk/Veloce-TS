/**
 * @module veloce-ts/errors/problem-details
 * @description Utilidades para respuestas de error alineadas con **RFC 9457** (Problem Details for HTTP APIs).
 * Define URIs de `type`, títulos por código de estado, `instance` a partir del request y el formato legacy.
 */

import type { Context } from '../types';

/** Media type oficial para cuerpos Problem Details (RFC 9457). */
export const PROBLEM_JSON_MEDIA_TYPE = 'application/problem+json';

/**
 * Base estable de URIs `type` documentadas en veloce-ts.com.
 * Los clientes pueden usar `type` para ramificar lógica sin parsear `detail`.
 */
export const DEFAULT_PROBLEM_TYPE_BASE = 'https://veloce-ts.com/problems';

/** Formato de respuesta configurable en {@link VeloceTSConfig.errorResponseFormat}. */
export type ErrorResponseFormat = 'rfc9457' | 'legacy';

const STATUS_SLUG: Record<number, string> = {
  400: 'bad-request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  410: 'gone',
  413: 'payload-too-large',
  422: 'unprocessable-entity',
  429: 'too-many-requests',
  500: 'internal-server-error',
  503: 'service-unavailable',
};

const STATUS_TITLE: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** Construye la URI `type` para un slug concreto bajo la base del framework. */
export function problemTypeUri(slug: string): string {
  return `${DEFAULT_PROBLEM_TYPE_BASE}/${slug}`;
}

/** Resuelve `type`: override del usuario, o URI por código HTTP. */
export function resolveProblemType(statusCode: number, override?: string): string {
  if (override) return override;
  const slug = STATUS_SLUG[statusCode] ?? 'unknown-error';
  return problemTypeUri(slug);
}

/** Título corto RFC (`title`): override, o etiqueta estándar por código. */
export function resolveProblemTitle(
  statusCode: number,
  message: string,
  titleOverride?: string
): string {
  if (titleOverride) return titleOverride;
  return STATUS_TITLE[statusCode] ?? message;
}

/**
 * `instance` identifica la ocurrencia concreta (p. ej. URL del request).
 * @see https://www.rfc-editor.org/rfc/rfc9457#name-instance
 */
export function buildProblemInstance(c: Context): string {
  try {
    return new URL(c.req.url).href;
  } catch {
    return c.req.path;
  }
}

/**
 * Cuerpo JSON **solo legacy** (`error`, `statusCode`, `details?`) a partir de un objeto Problem enriquecido.
 */
export function toLegacyErrorBody(body: Record<string, unknown>): Record<string, unknown> {
  const statusCode = (body.statusCode ?? body.status) as number;
  const error =
    (typeof body.error === 'string' ? body.error : null) ??
    (typeof body.detail === 'string' ? body.detail : 'Error');
  const legacy: Record<string, unknown> = {
    error,
    statusCode,
  };
  if (body.details !== undefined) legacy.details = body.details;
  else if (body.violations !== undefined) legacy.details = body.violations;
  return legacy;
}

/**
 * Serializa la respuesta HTTP: RFC 9457 + `Content-Type` correcto, o JSON legacy.
 */
export function sendErrorResponse(
  c: Context,
  bodyWithoutInstance: Record<string, unknown>,
  statusCode: number,
  format: ErrorResponseFormat
): Response {
  const instance = buildProblemInstance(c);
  const full = { ...bodyWithoutInstance, instance };

  if (format === 'legacy') {
    return c.json(toLegacyErrorBody(full), statusCode as any);
  }

  return new Response(JSON.stringify(full), {
    status: statusCode,
    headers: {
      'Content-Type': PROBLEM_JSON_MEDIA_TYPE,
    },
  });
}
