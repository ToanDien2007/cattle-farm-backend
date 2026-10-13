'use strict';
const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true }, // sha256 của token gốc, không lưu token gốc
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL tự dọn

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
