'use strict';
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// Lịch sử phân bổ/chuyển chuồng
const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    fromPenId: { type: ObjectId, ref: 'Pen' }, // null khi bò mới nhập đàn
    toPenId: { type: ObjectId, ref: 'Pen', required: true },
    movedAt: { type: Date, default: Date.now },
    movedBy: { type: ObjectId, ref: 'User' },
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ cattleId: 1, movedAt: -1 });
schema.index({ toPenId: 1 });
schema.index({ fromPenId: 1 });

module.exports = mongoose.model('PenAssignment', schema);
