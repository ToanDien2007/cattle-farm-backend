'use strict';
const ROLES = require('../../src/constants/roles');
const User = require('../../src/modules/users/user.model');
const { hashPassword } = require('../../src/modules/users/user.service');

// Admin không tự đăng ký được, nên cần seed tài khoản đầu tiên
module.exports = async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Thiếu ADMIN_EMAIL / ADMIN_PASSWORD trong .env');

  if (await User.exists({ email })) return console.log(`Admin ${email} đã tồn tại, bỏ qua`);

  await User.create({
    fullName: process.env.ADMIN_FULL_NAME || 'Quản trị viên',
    email,
    passwordHash: await hashPassword(password),
    role: ROLES.ADMIN,
  });
  console.log(`Đã tạo admin ${email}`);
};
