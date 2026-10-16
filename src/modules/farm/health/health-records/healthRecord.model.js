'use strict';
const mongoose = require('mongoose');
const { CONCLUSION } = require('../../../../constants/health');
const { normalizeForSearch } = require('../../../../utils/vietnamese');

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    cattleCode: { type: String, required: true, trim: true, uppercase: true }, // Mã bò không đổi => lưu kèm để tìm/xuất không cần join
    examDate: { type: Date, required: true },
    symptoms: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    treatment: { type: String, trim: true },
    medication: { type: String, trim: true },
    weightKg: { type: Number, min: 0.01 },
    performedBy: { type: String, required: true, trim: true },
    conclusion: { type: String, enum: Object.values(CONCLUSION) },

    // Sửa sau 24h phải có xác nhận bổ sung + lý do
    amendments: [{ _id: false, at: Date, by: { type: ObjectId, ref: 'User' }, reason: String }],

    createdBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
    deletedBy: { type: ObjectId, ref: 'User' },
    searchText: { type: String, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

schema.pre('validate', function prep() {
  this.searchText = normalizeForSearch([this.cattleCode, this.diagnosis].filter(Boolean).join(' '));
});

schema.index({ cattleId: 1, deletedAt: 1, examDate: -1 });
schema.index({ deletedAt: 1, examDate: -1 });

module.exports = mongoose.model('HealthRecord', schema);