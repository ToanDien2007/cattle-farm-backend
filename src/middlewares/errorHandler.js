'use strict';
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let e = err;
  if (err.type === 'entity.parse.failed') {
    e = ApiError.badRequest('JSON không hợp lệ', 'INVALID_JSON');
  } else if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((x) => ({ field: x.path, message: x.message }));
    e = ApiError.unprocessable('Dữ liệu không hợp lệ', details);
  } else if (err.name === 'CastError') {
    e = ApiError.badRequest(`Giá trị không hợp lệ ở trường ${err.path}`, 'INVALID_ID');
  } else if (err.code === 11000) {
    e = ApiError.conflict('Dữ liệu trùng khóa duy nhất', 'DUPLICATE_KEY', Object.keys(err.keyPattern || {}));
  }

  if (!(e instanceof ApiError)) {
    console.error(err);
    e = new ApiError(500, 'INTERNAL_ERROR', 'Lỗi hệ thống');
  }

  const body = { success: false, error: { code: e.code, message: e.message } };
  if (e.details) body.error.details = e.details;
  if (env.NODE_ENV === 'development' && e.status === 500) body.error.stack = err.stack;
  res.status(e.status).json(body);
};
