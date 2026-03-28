/**
 * @module veloce-ts/errors/exceptions
 * @description Jerarquía de excepciones HTTP usadas en handlers y middleware.
 * Todas extienden {@link HTTPException}; al serializarse incluyen campos **RFC 9457** (`type`, `title`, `status`, `detail`)
 * más espejos legacy (`error`, `statusCode`) para compatibilidad. El campo `instance` lo añade {@link ErrorHandler}.
 */

import {
  resolveProblemTitle,
  resolveProblemType,
} from './problem-details.js';

/** Opciones opcionales al construir un {@link HTTPException}. */
export type HTTPExceptionOptions = {
  /**
   * URI `type` del problema (RFC 9457). Si se omite, se usa la URI por defecto del framework para el código HTTP.
   */
  problemType?: string;
  /**
   * Título humano breve (`title`). Si se omite, se usa el título estándar del código (p. ej. "Not Found").
   * El mensaje del error sigue siendo `detail` para el cliente.
   */
  title?: string;
};

/**
 * Excepción HTTP base. Lánzala o extiéndela para respuestas 4xx/5xx tipadas.
 *
 * - `message` → se expone como `detail` (RFC) y como `error` (legacy).
 * - `details` → datos extra (extensión); en legacy suele mapearse a `details`.
 */
export class HTTPException extends Error {
  public readonly problemType?: string;
  public readonly title?: string;

  constructor(
    public statusCode: number,
    message: string,
    public details?: any,
    options?: HTTPExceptionOptions
  ) {
    super(message);
    this.name = 'HTTPException';
    this.problemType = options?.problemType;
    this.title = options?.title;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Representación JSON **sin** `instance` (se completa en el manejador con la URL del request).
   * Incluye campos RFC 9457 y alias legacy.
   */
  toJSON(): Record<string, unknown> {
    const status = this.statusCode;
    const type = resolveProblemType(status, this.problemType);
    const title = resolveProblemTitle(status, this.message, this.title);
    return {
      type,
      title,
      status,
      detail: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
      error: this.message,
      statusCode: status,
    };
  }
}

/** 404 — recurso inexistente o ruta no encontrada. */
export class NotFoundException extends HTTPException {
  constructor(message: string = 'Not Found', details?: any) {
    super(404, message, details, { title: 'Not Found' });
    this.name = 'NotFoundException';
  }
}

/** 401 — falta autenticación o credenciales inválidas. */
export class UnauthorizedException extends HTTPException {
  constructor(message: string = 'Unauthorized', details?: any) {
    super(401, message, details, { title: 'Unauthorized' });
    this.name = 'UnauthorizedException';
  }
}

/** 403 — autenticado pero sin permiso para la acción. */
export class ForbiddenException extends HTTPException {
  constructor(message: string = 'Forbidden', details?: any) {
    super(403, message, details, { title: 'Forbidden' });
    this.name = 'ForbiddenException';
  }
}

/** 400 — sintaxis o parámetros de request inválidos (distinto de validación de esquema Zod). */
export class BadRequestException extends HTTPException {
  constructor(message: string = 'Bad Request', details?: any) {
    super(400, message, details, { title: 'Bad Request' });
    this.name = 'BadRequestException';
  }
}

/** 409 — conflicto de estado (p. ej. duplicado, versión obsoleta). */
export class ConflictException extends HTTPException {
  constructor(message: string = 'Conflict', details?: any) {
    super(409, message, details, { title: 'Conflict' });
    this.name = 'ConflictException';
  }
}

/** 410 — el recurso existió y fue eliminado de forma permanente. */
export class GoneException extends HTTPException {
  constructor(message: string = 'Gone', details?: any) {
    super(410, message, details, { title: 'Gone' });
    this.name = 'GoneException';
  }
}

/** 413 — cuerpo demasiado grande. */
export class PayloadTooLargeException extends HTTPException {
  constructor(message: string = 'Payload Too Large', details?: any) {
    super(413, message, details, { title: 'Payload Too Large' });
    this.name = 'PayloadTooLargeException';
  }
}

/**
 * 422 — error semántico de negocio (no confundir con {@link ValidationException}, que envuelve Zod).
 */
export class UnprocessableEntityException extends HTTPException {
  constructor(message: string = 'Unprocessable Entity', details?: any) {
    super(422, message, details, { title: 'Unprocessable Entity' });
    this.name = 'UnprocessableEntityException';
  }
}

/** 429 — rate limit u otra política de throttling. */
export class TooManyRequestsException extends HTTPException {
  constructor(message: string = 'Too Many Requests', details?: any) {
    super(429, message, details, { title: 'Too Many Requests' });
    this.name = 'TooManyRequestsException';
  }
}

/** 503 — dependencia caída, mantenimiento, etc. */
export class ServiceUnavailableException extends HTTPException {
  constructor(message: string = 'Service Unavailable', details?: any) {
    super(503, message, details, { title: 'Service Unavailable' });
    this.name = 'ServiceUnavailableException';
  }
}
