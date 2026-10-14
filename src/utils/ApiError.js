'use strict';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(message, code = 'BAD_REQUEST', details) { return new ApiError(400, code, message, details); }
  static unauthorized(message, code = 'UNAUTHORIZED') { return new ApiError(401, code, message); }
  static forbidden(message, code = 'FORBIDDEN') { return new ApiError(403, code, message); }
  static notFound(message, code = 'NOT_FOUND', details) { return new ApiError(404, code, message, details); }
  static conflict(message, code = 'CONFLICT', details) { return new ApiError(409, code, message, details); }
  static unprocessable(message, details, code = 'VALIDATION_ERROR') { return new ApiError(422, code, message, details); }
}

module.exports = ApiError;
