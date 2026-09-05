/**
 * @module veloce-ts/errors
 * @description Public surface of the error subsystem: HTTP exceptions, {@link ErrorHandler} and RFC 9457 helpers.
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

export type { ExceptionFilter } from './exception-filter.js';
export { Catch, FilterManager } from './exception-filter.js';

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
