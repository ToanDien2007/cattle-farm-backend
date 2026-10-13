'use strict';
const ApiError = require('../utils/ApiError');

// authorize(ROLES.ADMIN) - đặt SAU authenticate()
module.exports = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(ApiError.forbidden('Bạn không có quyền thực hiện chức năng này'));
  }
  next();
};
