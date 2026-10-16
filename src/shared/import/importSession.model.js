'use strict';
const mongoose = require('mongoose');

// Phiên import: preview (chạy thử) -> confirm. Tự xóa sau 30 phút.
const importSessionSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true }, // 'cattle', ...
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fileName: String,
    status: { type: String, enum: ['PREVIEW', 'CONFIRMED'], default: 'PREVIEW' },
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{ rowNumber, values }]
    summary: mongoose.Schema.Types.Mixed, // { total, valid, invalid } hoặc { total, success, failed }
    rowErrors: { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{ rowNumber, messages }]
    confirmedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

importSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ImportSession', importSessionSchema);
