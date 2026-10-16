'use strict';
const mongoose = require('mongoose');
const { normalizeForSearch } = require('../../../utils/vietnamese');

const penSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'Sức chứa phải là số nguyên dương' } },
    zone: { type: String, required: true, trim: true }, // Khu vực
    type: { type: String, trim: true }, // Loại chuồng
    deletedAt: { type: Date, default: null }, // xóa mềm khi chuồng đã có lịch sử chuyển chuồng
    searchText: { type: String, select: false },
  },
  { timestamps: true }
);

penSchema.pre('validate', function prep() {
  this.searchText = normalizeForSearch([this.code, this.name].filter(Boolean).join(' '));
});
penSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('Pen', penSchema);
