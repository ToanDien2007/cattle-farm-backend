'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../modules/users/user.model');

// authenticate()                          -> chặn tài khoản đang bị buộc đổi mật khẩu
// authenticate({ allowPasswordChange })   -> dùng cho /auth/change-password, /auth/me
const authenticate = (options = {}) =>
  asyncHandler(async (req, res, next) => {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized('Thiếu access token', 'NO_TOKEN');

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw ApiError.unauthorized('Access token không hợp lệ hoặc đã hết hạn', 'INVALID_TOKEN');
    }

    const user = await User.findOne({ _id: payload.sub, deletedAt: null });
    if (!user) throw ApiError.unauthorized('Tài khoản không tồn tại', 'INVALID_TOKEN');
    if (user.isLocked) throw ApiError.forbidden('Tài khoản đã bị khóa', 'ACCOUNT_LOCKED');
    if (user.mustChangePassword && !options.allowPasswordChange) {
      throw ApiError.forbidden('Bạn cần đổi mật khẩu trước khi tiếp tục', 'PASSWORD_CHANGE_REQUIRED');
    }

    req.user = user;
    next();
  });

module.exports = authenticate;
