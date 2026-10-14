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

const PURPOSE = { RESET: 'RESET_PASSWORD', VERIFY: 'VERIFY_ACCOUNT' };
const OTP_TTL_MIN = { RESET_PASSWORD: env.OTP_TTL_MINUTES, VERIFY_ACCOUNT: env.VERIFY_TTL_MINUTES };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', env.OTP_SECRET || 'test-otp-secret').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10); // so sánh giả khi không có user, tránh lộ qua thời gian phản hồi
const invalidOtp = () => ApiError.badRequest('OTP không hợp lệ hoặc đã hết hạn', 'INVALID_OTP');

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
// Thu hồi mọi phiên của nhiều user (khóa/xóa tài khoản)
const revokeSessions = (userIds) => RefreshToken.updateMany({ userId: { $in: userIds }, revokedAt: null }, { revokedAt: new Date() });

// ---- OTP dùng chung (đăng ký / quên mật khẩu) ----
// Trả false nếu bị chặn do gửi lại trong vòng OTP_RESEND_SECONDS (chống spam)
async function sendNewOtp(user, purpose, channel) {
  const last = await OtpToken.findOne({ userId: user._id, purpose });
  if (last && Date.now() - new Date(last.createdAt).getTime() < env.OTP_RESEND_SECONDS * 1000) return false;

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await OtpToken.deleteMany({ userId: user._id, purpose });
  await OtpToken.create({
    userId: user._id,
    purpose,
    codeHash: hmac(`${user._id}:${code}`),
    expiresAt: new Date(Date.now() + OTP_TTL_MIN[purpose] * 60 * 1000),
  });

  try {
    await sendOtp(user, code, { channel, purpose });
  } catch (err) {
    console.error('Gửi OTP thất bại:', err.message);
  }
  return true;
}

// Đúng thì xóa OTP (dùng 1 lần); sai thì tăng số lần thử
async function checkOtp(user, purpose, code) {
  const record = await OtpToken.findOne({ userId: user._id, purpose });
  if (!record || record.expiresAt <= new Date() || record.attempts >= env.OTP_MAX_ATTEMPTS) return false;

  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hmac(`${user._id}:${code}`), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    await OtpToken.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    return false;
  }
  await OtpToken.deleteMany({ userId: user._id, purpose });
  return true;
}

// ---- Đăng ký / xác thực ----
// Khách tự đăng ký -> 'Chưa xác thực' + gửi OTP; quá VERIFY_TTL_MINUTES không xác thực thì tự hủy.
// Admin không tự đăng ký (tài khoản nhân sự do admin tạo ở module accounts).
async function register({ fullName, identifier, newPassword }) {
  // TTL index dọn chậm (~60s) nên xóa trước các tài khoản chưa xác thực đã quá hạn của cùng Email/SĐT
  await User.deleteOne({ [identifier.type]: identifier.value, isVerified: false, verifyExpiresAt: { $lte: new Date() } });

  const taken = () => ApiError.conflict('Email/SĐT đã được đăng ký', 'IDENTIFIER_TAKEN');
  if (await User.exists({ [identifier.type]: identifier.value })) throw taken();

  let user;
  try {
    user = await User.create({
      fullName,
      [identifier.type]: identifier.value,
      passwordHash: await hashPassword(newPassword),
      role: ROLES.CUSTOMER,
      isVerified: false,
      verifyExpiresAt: new Date(Date.now() + env.VERIFY_TTL_MINUTES * 60 * 1000),
    });
  } catch (err) {
    if (err.code === 11000) throw taken();
    throw err;
  }
  await sendNewOtp(user, PURPOSE.VERIFY, identifier.type);
  return user.toPublic();
}

async function verifyAccount({ identifier, otp }) {
  const user = await User.findOne({ [identifier.type]: identifier.value, deletedAt: null });
  if (!user || user.isVerified) throw invalidOtp();
  if (user.verifyExpiresAt && user.verifyExpiresAt <= new Date()) {
    await User.deleteOne({ _id: user._id });
    throw invalidOtp();
  }
  if (!(await checkOtp(user, PURPOSE.VERIFY, otp))) throw invalidOtp();
  await User.updateOne({ _id: user._id }, { $set: { isVerified: true }, $unset: { verifyExpiresAt: 1 } });
}

// Luôn trả thành công. Gửi lại thành công thì gia hạn thời hạn xác thực thêm VERIFY_TTL_MINUTES.
async function resendVerifyOtp({ identifier }) {
  const user = await User.findOne({ [identifier.type]: identifier.value, deletedAt: null });
  if (!user || user.isVerified) return;
  if (user.verifyExpiresAt && user.verifyExpiresAt <= new Date()) {
    await User.deleteOne({ _id: user._id });
    return;
  }
  if (await sendNewOtp(user, PURPOSE.VERIFY, identifier.type)) {
    await User.updateOne({ _id: user._id }, { $set: { verifyExpiresAt: new Date(Date.now() + env.VERIFY_TTL_MINUTES * 60 * 1000) } });
  }
}

// ---- Đăng nhập ----
async function login({ identifier, password }, meta) {
  const user = await findByIdentifier(identifier);

  // Khóa tạm do sai mật khẩu: không kiểm tra mật khẩu trong thời gian khóa
  if (user?.loginLockedUntil && user.loginLockedUntil > new Date()) throw loginLockedError(user.loginLockedUntil);

  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginCount: 1 } }, { new: true });
      if (updated && updated.failedLoginCount >= env.LOGIN_MAX_ATTEMPTS) {
        const until = new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60 * 1000);
        await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, loginLockedUntil: until } });
        throw loginLockedError(until);
      }
    }
    throw ApiError.unauthorized('Sai tài khoản hoặc mật khẩu', 'INVALID_CREDENTIALS');
  }

  if (user.isLocked) throw ApiError.forbidden('Tài khoản đã bị khóa', 'ACCOUNT_LOCKED');
  if (user.isVerified === false) {
    throw ApiError.forbidden('Tài khoản chưa xác thực, vui lòng xác thực lại bằng OTP', 'ACCOUNT_NOT_VERIFIED');
  }

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), failedLoginCount: 0 }, $unset: { loginLockedUntil: 1 } });
  return { user: user.toPublic(), ...(await issueTokens(user, meta)) };
}

function loginLockedError(until) {
  const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  return new ApiError(
    429,
    'LOGIN_TEMPORARILY_LOCKED',
    `Đăng nhập sai quá nhiều lần, vui lòng thử lại sau ${Math.ceil(retryAfterSeconds / 60)} phút`,
    { retryAfterSeconds }
  );
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

// ---- Quên / đặt lại / đổi mật khẩu ----
// Luôn trả thành công (không lộ tài khoản có tồn tại hay không); gửi lại cách nhau tối thiểu OTP_RESEND_SECONDS
async function forgotPassword({ identifier }) {
  const user = await User.findOne({ [identifier.type]: identifier.value, deletedAt: null });
  if (!user || user.isLocked || user.isVerified === false) return;
  await sendNewOtp(user, PURPOSE.RESET, identifier.type);
}

async function resetPassword({ identifier, otp, newPassword }) {
  const user = await User.findOne({ [identifier.type]: identifier.value, deletedAt: null });
  if (!user || user.isLocked || user.isVerified === false) throw invalidOtp();
  if (!(await checkOtp(user, PURPOSE.RESET, otp))) throw invalidOtp();

  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, failedLoginCount: 0 }, $unset: { loginLockedUntil: 1 } }
  );
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

module.exports = { revokeSessions, register, verifyAccount, resendVerifyOtp, login, refresh, logout, forgotPassword, resetPassword, changePassword };
