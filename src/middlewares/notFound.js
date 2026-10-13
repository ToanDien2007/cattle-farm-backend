'use strict';
const ApiError = require('../utils/ApiError');

module.exports = (req, res, next) => next(ApiError.notFound(`Không tìm thấy ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
