'use strict';
const { z } = require('zod');
const { parseIdentifier } = require('../../utils/identifier');

const identifier = z
  .string()
  .transform((v, ctx) => {
    const parsed = parseIdentifier(v);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Email/SĐT không hợp lệ' });
      return z.NEVER;
    }
    return parsed;
  });

// Tối thiểu 8 ký tự gồm hoa/thường/số
const password = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .regex(/[a-z]/, 'Mật khẩu phải có chữ thường')
  .regex(/[A-Z]/, 'Mật khẩu phải có chữ hoa')
  .regex(/\d/, 'Mật khẩu phải có chữ số');

const matchConfirm = (data, ctx) => {
  if (data.newPassword !== data.confirmPassword) {
    ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Xác nhận mật khẩu không khớp' });
  }
};

const register = z
  .object({
    fullName: z.string().trim().min(1, 'Bắt buộc nhập họ tên'),
    identifier,
    newPassword: password,
    confirmPassword: z.string(),
  })
  .superRefine(matchConfirm);

const login = z.object({ identifier, password: z.string().min(1, 'Bắt buộc nhập mật khẩu') });

const refresh = z.object({ refreshToken: z.string().min(1) });
const logout = refresh;

const forgotPassword = z.object({ identifier });

const resetPassword = z
  .object({
    identifier,
    otp: z.string().regex(/^\d{6}$/, 'OTP gồm 6 chữ số'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .superRefine(matchConfirm);

const changePassword = z
  .object({
    currentPassword: z.string().min(1, 'Bắt buộc nhập mật khẩu hiện tại'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .superRefine(matchConfirm)
  .superRefine((d, ctx) => {
    if (d.newPassword === d.currentPassword) {
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    }
  });

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword, changePassword };
