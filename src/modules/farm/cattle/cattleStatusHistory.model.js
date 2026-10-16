'use strict';
const mongoose = require('mongoose');
const { CATTLE_STATUS, REMOVAL_TYPE } = require('../../../constants/cattleStatus');

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    from: { type: String, enum: Object.values(CATTLE_STATUS), required: true },
    to: { type: String, enum: Object.values(CATTLE_STATUS), required: true },
    removalType: { type: String, enum: Object.values(REMOVAL_TYPE) },
    effectiveDate: { type: Date, required: true }, // Ngày chuyển
    reason: String,
    note: String,
    changedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ cattleId: 1, createdAt: -1 });

module.exports = mongoose.model('CattleStatusHistory', schema);
