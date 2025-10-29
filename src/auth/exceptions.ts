import { HTTPException } from '../errors/exceptions.js';

export class AuthenticationException extends HTTPException {
  constructor(message: string = 'Authentication required') {
    super(401, message);
    this.name = 'AuthenticationException';
  }

  toJSON() {
    return {
      error: 'Authentication Error',
      message: this.message,
      statusCode: 401,
    };
  }
}

export class AuthorizationException extends HTTPException {
  constructor(message: string = 'Insufficient permissions') {
    super(403, message);
    this.name = 'AuthorizationException';
  }

  toJSON() {
    return {
      error: 'Authorization Error',
      message: this.message,
      statusCode: 403,
    };
  }
}

export class TokenExpiredException extends AuthenticationException {
  constructor(message: string = 'Token has expired') {
    super(message);
    this.name = 'TokenExpiredException';
  }
}

export class InvalidTokenException extends AuthenticationException {
  constructor(message: string = 'Invalid token') {
    super(message);
    this.name = 'InvalidTokenException';
  }
}

export class TokenRevokedException extends AuthenticationException {
  constructor(message: string = 'Token has been revoked') {
    super(message);
    this.name = 'TokenRevokedException';
  }
}