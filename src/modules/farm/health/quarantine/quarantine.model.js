'use strict';
const mongoose = require('mongoose');
const { QUARANTINE_STATUS, QUARANTINE_OUTCOME } = require('../../../../constants/health');
const { normalizeForSearch } = require('../../../../utils/vietnamese');

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    cattleCode: { type: String, required: true, trim: true, uppercase: true },
    disease: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    expectedRecoveryDate: Date,
    note: { type: String, trim: true },
    status: { type: String, enum: Object.values(QUARANTINE_STATUS), default: QUARANTINE_STATUS.ACTIVE },

    // Theo dõi diễn biến trong thời gian cách ly
    progress: [{ _id: false, at: { type: Date, required: true }, note: { type: String, required: true, trim: true }, by: { type: ObjectId, ref: 'User' } }],

    endDate: Date,
    outcome: { type: String, enum: Object.values(QUARANTINE_OUTCOME) },
    endNote: { type: String, trim: true },

    startedBy: { type: ObjectId, ref: 'User' },
    endedBy: { type: ObjectId, ref: 'User' },
    searchText: { type: String, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

schema.pre('validate', function prep() {
  this.searchText = normalizeForSearch([this.cattleCode, this.disease].filter(Boolean).join(' '));
});

schema.index({ startDate: -1 });
schema.index({ cattleId: 1, startDate: -1 });
// Mỗi bò chỉ có tối đa 1 đợt cách ly đang diễn ra (chốt chặn ở DB khi 2 request đồng thời)
schema.index({ cattleId: 1 }, { unique: true, partialFilterExpression: { status: QUARANTINE_STATUS.ACTIVE } });

module.exports = mongoose.model('Quarantine', schema);