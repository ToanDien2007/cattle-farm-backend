'use strict';
const mongoose = require('mongoose');
const { NO_DUE_DATE } = require('../../../../constants/health');
const { normalizeForSearch } = require('../../../../utils/vietnamese');

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    cattleCode: { type: String, required: true, trim: true, uppercase: true },
    vaccineType: { type: String, required: true, trim: true },
    vaccineKey: { type: String, required: true }, // vaccineType không dấu/hoa thường: lọc, so chống chỉ định, nối lần tiêm
    vaccinationDate: { type: Date, required: true },
    dose: { type: String, required: true, trim: true },
    nextDueDate: Date, // Ngày tái tiêm (nhập tay hoặc = ngày tiêm + intervalDays)
    performedBy: { type: String, required: true, trim: true },

    // Do relink() duy trì: renewedBy = lần tiêm sau cùng loại đã thay thế lịch này;
    // dueSort = nextDueDate nếu lịch còn mở, ngược lại NO_DUE_DATE (để sắp xếp tăng dần xếp cuối)
    renewedBy: { type: ObjectId, ref: 'Vaccination' },
    dueSort: { type: Date, default: NO_DUE_DATE },

    createdBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
    deletedBy: { type: ObjectId, ref: 'User' },
    searchText: { type: String, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

schema.pre('validate', function prep() {
  this.vaccineKey = normalizeForSearch(this.vaccineType);
  this.searchText = normalizeForSearch([this.cattleCode, this.vaccineType].filter(Boolean).join(' '));
});

schema.index({ cattleId: 1, vaccineKey: 1, deletedAt: 1, vaccinationDate: 1 });
schema.index({ deletedAt: 1, dueSort: 1 });

module.exports = mongoose.model('Vaccination', schema);