/**
 * @module veloce-ts/auth/exceptions
 * @description Errores específicos de autenticación/autorización JWT/sesión. Extienden {@link HTTPException}
 * con `problemType` dedicados para clientes que discriminan por URI RFC 9457.
 */

import { HTTPException } from '../errors/exceptions.js';
import { problemTypeUri } from '../errors/problem-details.js';

export class AuthenticationException extends HTTPException {
  constructor(message: string = 'Authentication required') {
    super(401, message, undefined, {
      title: 'Authentication Error',
      problemType: problemTypeUri('authentication-error'),
    });
    this.name = 'AuthenticationException';
  }
}

export class AuthorizationException extends HTTPException {
  constructor(message: string = 'Insufficient permissions') {
    super(403, message, undefined, {
      title: 'Authorization Error',
      problemType: problemTypeUri('authorization-error'),
    });
    this.name = 'AuthorizationException';
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
