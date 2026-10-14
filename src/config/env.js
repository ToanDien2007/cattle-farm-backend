'use strict';
require('dotenv').config({ quiet: true });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 5000,
  MONGODB_URI: process.env.MONGODB_URI,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || '15m',
  REFRESH_TTL_DAYS: Number(process.env.REFRESH_TTL_DAYS) || 7,

  OTP_SECRET: process.env.OTP_SECRET,
  OTP_TTL_MINUTES: Number(process.env.OTP_TTL_MINUTES) || 5,
  OTP_MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  OTP_RESEND_SECONDS: Number(process.env.OTP_RESEND_SECONDS) || 60,
  VERIFY_TTL_MINUTES: Number(process.env.VERIFY_TTL_MINUTES) || 10, // quá hạn chưa xác thực OTP thì tài khoản tự hủy

  LOGIN_MAX_ATTEMPTS: Number(process.env.LOGIN_MAX_ATTEMPTS) || 5,
  LOGIN_LOCK_MINUTES: Number(process.env.LOGIN_LOCK_MINUTES) || 15,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  MAIL_FROM: process.env.MAIL_FROM || 'no-reply@cattle-farm.local',
};

if (env.NODE_ENV !== 'test') {
  const missing = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'OTP_SECRET'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Thiếu biến môi trường: ${missing.join(', ')}`);
}

module.exports = env;
