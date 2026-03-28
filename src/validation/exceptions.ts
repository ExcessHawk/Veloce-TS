/**
 * @module veloce-ts/validation/exceptions
 * @description {@link ValidationException}: error 422 cuando falla la validación Zod en `@Body`, `@Query`, etc.
 * Expone `violations` (lista de campos/mensajes/códigos) y el formato Problem Details + legacy `details`.
 */

import { ZodError } from 'zod';
import { HTTPException } from '../errors/exceptions.js';
import { problemTypeUri, resolveProblemTitle } from '../errors/problem-details.js';

/**
 * Convierte la ruta Zod (`path`) en string legible (`user.email`, `items[0].price`, …).
 */
function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '(root)';

  return path.reduce<string>((acc, segment, idx) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return idx === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

/**
 * Se lanza cuando un esquema Zod rechaza el input. El framework la convierte en respuesta 422.
 */
export class ValidationException extends HTTPException {
  constructor(public zodError: ZodError) {
    super(422, 'One or more fields did not pass validation.', undefined, {
      problemType: problemTypeUri('validation-error'),
      title: 'Validation Error',
    });
    this.name = 'ValidationException';
  }

  /**
   * Cuerpo JSON sin `instance`: RFC 9457 + `violations` + alias legacy (`details`, `error`, `statusCode`).
   */
  toJSON(): Record<string, unknown> {
    const violations = this.zodError.errors.map((err) => {
      const row: Record<string, unknown> = {
        field: formatPath(err.path),
        message: err.message,
        code: err.code,
      };
      if ('received' in err && err.received !== undefined) {
        row.received = err.received;
      }
      if ('expected' in err && (err as any).expected !== undefined) {
        row.expected = (err as any).expected;
      }
      if ('minimum' in err) row.minimum = (err as any).minimum;
      if ('maximum' in err) row.maximum = (err as any).maximum;
      return row;
    });

    const status = this.statusCode;
    const title = resolveProblemTitle(status, this.message, 'Validation Error');

    return {
      type: problemTypeUri('validation-error'),
      title,
      status,
      detail: this.message,
      violations,
      details: violations,
      error: 'Validation Error',
      statusCode: status,
    };
  }
}
