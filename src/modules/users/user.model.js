'use strict';
const mongoose = require('mongoose');
const ROLES = require('../../constants/roles');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.CUSTOMER, required: true },
    isLocked: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false }, // mật khẩu tạm của tài khoản nhân sự
    lastLoginAt: { type: Date },
    deletedAt: { type: Date, default: null }, // xóa mềm
  },
  { timestamps: true }
);

// unique chỉ khi có giá trị (khách đăng ký bằng SĐT thì không có email và ngược lại)
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    role: this.role,
    mustChangePassword: this.mustChangePassword,
  };
};

module.exports = mongoose.model('User', userSchema);
