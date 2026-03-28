/**
 * @module veloce-ts/errors
 * @description Export público del subsistema de errores: excepciones HTTP, {@link ErrorHandler} y utilidades RFC 9457.
 */

export {
  HTTPException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  GoneException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  TooManyRequestsException,
  ServiceUnavailableException,
  type HTTPExceptionOptions,
} from './exceptions.js';

export { ErrorHandler, type CustomErrorHandler, type ErrorHandlerOptions } from './handler.js';

export {
  PROBLEM_JSON_MEDIA_TYPE,
  DEFAULT_PROBLEM_TYPE_BASE,
  problemTypeUri,
  resolveProblemType,
  resolveProblemTitle,
  buildProblemInstance,
  toLegacyErrorBody,
  sendErrorResponse,
  type ErrorResponseFormat,
} from './problem-details.js';
