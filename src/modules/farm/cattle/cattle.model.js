'use strict';
const mongoose = require('mongoose');
const { CATTLE_STATUS, SEX, ORIGIN, REMOVAL_TYPE } = require('../../../constants/cattleStatus');
const { normalizeForSearch } = require('../../../utils/vietnamese');

const { ObjectId } = mongoose.Schema.Types;

const cattleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true }, // Mã bò, không đổi sau khi tạo
    earTag: { type: String, required: true, trim: true, uppercase: true }, // Số tai/RFID
    name: { type: String, trim: true },
    breedId: { type: ObjectId, ref: 'Breed', required: true },
    sex: { type: String, enum: Object.values(SEX), required: true },
    birthDate: { type: Date, required: true },
    weightKg: { type: Number, required: true, min: 0.01 },
    penId: { type: ObjectId, ref: 'Pen', required: true },
    origin: { type: String, enum: Object.values(ORIGIN) },
    joinDate: { type: Date, required: true }, // Ngày nhập đàn
    image: { type: String, trim: true },
    note: { type: String, trim: true },

    status: { type: String, enum: Object.values(CATTLE_STATUS), default: CATTLE_STATUS.RAISING },
    statusChangedAt: Date,
    exit: {
      // thông tin lần chuyển trạng thái cuối (bán/chết/xuất chuồng/loại thải)
      date: Date,
      removalType: { type: String, enum: Object.values(REMOVAL_TYPE) },
      reason: String,
    },

    sireId: { type: ObjectId, ref: 'Cattle' }, // Bố
    damId: { type: ObjectId, ref: 'Cattle' }, // Mẹ

    searchText: { type: String, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

cattleSchema.pre('validate', function prep() {
  this.searchText = normalizeForSearch([this.code, this.earTag, this.name].filter(Boolean).join(' '));
});

cattleSchema.index({ code: 1 }, { unique: true });
cattleSchema.index({ earTag: 1 }, { unique: true });
cattleSchema.index({ breedId: 1, status: 1 });
cattleSchema.index({ penId: 1, status: 1 });
cattleSchema.index({ sireId: 1 }, { sparse: true });
cattleSchema.index({ damId: 1 }, { sparse: true });

module.exports = mongoose.model('Cattle', cattleSchema);
