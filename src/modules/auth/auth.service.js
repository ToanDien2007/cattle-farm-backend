'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const ROLES = require('../../constants/roles');
const User = require('../users/user.model');
const { hashPassword, verifyPassword } = require('../users/user.service');
const RefreshToken = require('./refreshToken.model');
const OtpToken = require('./otpToken.model');
const { sendOtp } = require('../../integrations/mailer/mailer.service');

const PURPOSE_RESET = 'RESET_PASSWORD';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', env.OTP_SECRET || 'test-otp-secret').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10); // so sánh giả khi không có user, tránh lộ qua thời gian phản hồi

const findByIdentifier = ({ type, value }) => User.findOne({ [type]: value, deletedAt: null }).select('+passwordHash');

function signAccessToken(user) {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: String(user._id),
    expiresIn: env.JWT_ACCESS_EXPIRES,
  });
}

async function issueTokens(user, meta = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 3600 * 1000),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { accessToken: signAccessToken(user), refreshToken: raw, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_EXPIRES };
}

const revokeAll = (userId) => RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });

// Khách tự đăng ký (admin không tự đăng ký - tài khoản nhân sự do admin tạo)
async function register({ fullName, identifier, newPassword }) {
  const exists = await User.exists({ [identifier.type]: identifier.value });
  if (exists) throw ApiError.conflict('Email/SĐT đã được đăng ký', 'IDENTIFIER_TAKEN');

  try {
    const user = await User.create({
      fullName,
      [identifier.type]: identifier.value,
      passwordHash: await hashPassword(newPassword),
      role: ROLES.CUSTOMER,
    });
    return user.toPublic();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('Email/SĐT đã được đăng ký', 'IDENTIFIER_TAKEN');
    throw err;
  }
}

async function login({ identifier, password }, meta) {
  const user = await findByIdentifier(identifier);
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw ApiError.unauthorized('Sai tài khoản hoặc mật khẩu', 'INVALID_CREDENTIALS');
  if (user.isLocked) throw ApiError.forbidden('Tài khoản đã bị khóa', 'ACCOUNT_LOCKED');

  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  return { user: user.toPublic(), ...(await issueTokens(user, meta)) };
}

// Xoay vòng refresh token; dùng lại token đã thu hồi => thu hồi toàn bộ phiên của user
async function refresh(rawToken, meta) {
  const now = new Date();
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash: sha256(rawToken), revokedAt: null, expiresAt: { $gt: now } },
    { revokedAt: now }
  );

  if (!claimed) {
    const old = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
    if (old && old.revokedAt) await revokeAll(old.userId);
    throw ApiError.unauthorized('Refresh token không hợp lệ hoặc đã hết hạn', 'INVALID_REFRESH_TOKEN');
  }

  const user = await User.findOne({ _id: claimed.userId, deletedAt: null });
  if (!user || user.isLocked) throw ApiError.unauthorized('Tài khoản không khả dụng', 'INVALID_REFRESH_TOKEN');
  return issueTokens(user, meta);
}

async function logout(rawToken) {
  await RefreshToken.updateOne({ tokenHash: sha256(rawToken), revokedAt: null }, { revokedAt: new Date() });
}

// Luôn trả thành công (không lộ tài khoản có tồn tại hay không)
async function forgotPassword({ identifier }) {
  const user = await User.findOne({ [identifier.type]: identifier.value, deletedAt: null });
  if (!user || user.isLocked) return;

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await OtpToken.deleteMany({ userId: user._id, purpose: PURPOSE_RESET });
  await OtpToken.create({
    userId: user._id,
    purpose: PURPOSE_RESET,
    codeHash: hmac(`${user._id}:${code}`),
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
  });

  try {
    await sendOtp(user, code, { channel: identifier.type });
  } catch (err) {
    console.error('Gửi OTP thất bại:', err.message);
  }
}

async function resetPassword({ identifier, otp, newPassword }) {
  const invalid = () => ApiError.badRequest('OTP không hợp lệ hoặc đã hết hạn', 'INVALID_OTP');

  const user = await User.findOne({ [identifier.type]: identifier.value, deletedAt: null });
  if (!user || user.isLocked) throw invalid();

  const record = await OtpToken.findOne({ userId: user._id, purpose: PURPOSE_RESET });
  if (!record || record.expiresAt <= new Date() || record.attempts >= env.OTP_MAX_ATTEMPTS) throw invalid();

  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hmac(`${user._id}:${otp}`), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    await OtpToken.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    throw invalid();
  }

  await User.updateOne({ _id: user._id }, { passwordHash: await hashPassword(newPassword), mustChangePassword: false });
  await OtpToken.deleteMany({ userId: user._id, purpose: PURPOSE_RESET });
  await revokeAll(user._id);
}

// Đổi mật khẩu của chính mình; thu hồi mọi phiên cũ, cấp token mới cho phiên hiện tại
async function changePassword(userId, { currentPassword, newPassword }, meta) {
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Tài khoản không tồn tại', 'INVALID_TOKEN');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest('Mật khẩu hiện tại không đúng', 'WRONG_CURRENT_PASSWORD');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
  await revokeAll(user._id);
  return issueTokens(user, meta);
}

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword, changePassword };
