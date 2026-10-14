'use strict';
const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/response');
const svc = require('./auth.service');

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

exports.register = asyncHandler(async (req, res) => ok(res, await svc.register(req.body), 201));
exports.verifyOtp = asyncHandler(async (req, res) => {
  await svc.verifyAccount(req.body);
  ok(res, { message: 'Xác thực thành công, bạn có thể đăng nhập' });
});

exports.resendOtp = asyncHandler(async (req, res) => {
  await svc.resendVerifyOtp(req.body);
  ok(res, { message: 'Nếu tài khoản đang chờ xác thực, mã OTP mới đã được gửi' });
});

exports.login = asyncHandler(async (req, res) => ok(res, await svc.login(req.body, meta(req))));
exports.refresh = asyncHandler(async (req, res) => ok(res, await svc.refresh(req.body.refreshToken, meta(req))));

exports.logout = asyncHandler(async (req, res) => {
  await svc.logout(req.body.refreshToken);
  ok(res, null);
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  await svc.forgotPassword(req.body);
  ok(res, { message: 'Nếu tài khoản tồn tại, mã OTP đã được gửi' });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  await svc.resetPassword(req.body);
  ok(res, { message: 'Đặt lại mật khẩu thành công, vui lòng đăng nhập lại' });
});

exports.changePassword = asyncHandler(async (req, res) =>
  ok(res, await svc.changePassword(req.user._id, req.body, meta(req)))
);

exports.me = (req, res) => ok(res, req.user.toPublic());
