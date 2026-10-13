'use strict';
const rateLimit = require('express-rate-limit');

// Giới hạn cho nhóm /auth (chống dò mật khẩu, spam OTP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Thao tác quá nhiều lần, vui lòng thử lại sau' } },
});

module.exports = { authLimiter };
