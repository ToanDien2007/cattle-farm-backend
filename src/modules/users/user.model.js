'use strict';
const mongoose = require('mongoose');
const ROLES = require('../../constants/roles');
const { buildSearchText, statusOf } = require('./user.service');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.CUSTOMER, required: true },

    // Trạng thái: Hoạt động / Đã khóa (isLocked) / Chưa xác thực (isVerified=false)
    isVerified: { type: Boolean, default: true },
    verifyExpiresAt: { type: Date }, // quá hạn mà chưa xác thực OTP -> TTL index tự xóa
    isLocked: { type: Boolean, default: false }, // admin khóa / xóa mềm tài khoản nhân sự
    lockReason: { type: String, trim: true },
    lockedAt: { type: Date },
    mustChangePassword: { type: Boolean, default: false }, // mật khẩu tạm của tài khoản nhân sự

    failedLoginCount: { type: Number, default: 0 }, // sai liên tiếp
    loginLockedUntil: { type: Date }, // khóa tạm do sai mật khẩu quá số lần
    lastLoginAt: { type: Date },

    // Denormalized, module orders sẽ $inc khi đơn hoàn tất/đã thanh toán (VND, số nguyên)
    stats: {
      totalSpent: { type: Number, default: 0 },
      orderCount: { type: Number, default: 0 },
    },

    deletedAt: { type: Date, default: null }, // xóa mềm
    searchText: { type: String, select: false }, // họ tên + email + SĐT đã bỏ dấu, phục vụ tìm kiếm
  },
  { timestamps: true }
);

userSchema.pre('validate', function setSearchText() {
  this.searchText = buildSearchText(this);
});

// unique chỉ khi có giá trị (khách đăng ký bằng SĐT thì không có email và ngược lại)
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ verifyExpiresAt: 1 }, { expireAfterSeconds: 0 }); // chỉ doc có field này bị TTL xóa
userSchema.index({ role: 1, deletedAt: 1, createdAt: -1 });

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    role: this.role,
    status: statusOf(this),
    mustChangePassword: this.mustChangePassword,
  };
};

module.exports = mongoose.model('User', userSchema);
