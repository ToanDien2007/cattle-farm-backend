'use strict';
const mongoose = require('mongoose');
const { MILK_SHIFT } = require('../../../../constants/production');
const { normalizeForSearch } = require('../../../../utils/vietnamese');

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    cattleCode: { type: String, required: true, trim: true, uppercase: true },
    penId: { type: ObjectId, ref: 'Pen', required: true }, // chuồng của bò tại thời điểm ghi nhận (để lọc theo Chuồng)
    date: { type: Date, required: true }, // 00:00 GMT+7
    shift: { type: String, enum: Object.values(MILK_SHIFT), required: true },
    volumeLiters: { type: Number, required: true, min: 0.01 },
    quality: { type: String, trim: true },

    // Sửa sau ngày ghi nhận: Quản trị viên xác nhận lại + lý do
    amendments: [{ _id: false, at: Date, by: { type: ObjectId, ref: 'User' }, reason: String }],

    createdBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
    deletedBy: { type: ObjectId, ref: 'User' },
    searchText: { type: String, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

schema.pre('validate', function prep() {
  this.searchText = normalizeForSearch(this.cattleCode);
});

// 1 bò / 1 ca / 1 ngày: bản ghi chưa xóa có deletedAt rỗng nên không trùng được; bản ghi đã xóa mang deletedAt riêng
schema.index({ cattleId: 1, date: 1, shift: 1, deletedAt: 1 }, { unique: true });
schema.index({ deletedAt: 1, date: -1 });
schema.index({ penId: 1, date: -1 });

module.exports = mongoose.model('MilkRecord', schema);