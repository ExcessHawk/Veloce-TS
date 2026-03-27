/**
 * Error handling exports
 * Provides all exception classes and error handler
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
} from './exceptions.js';

export { ErrorHandler } from './handler.js';
