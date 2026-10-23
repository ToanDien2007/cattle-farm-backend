'use strict';
const mongoose = require('mongoose');
const { MEAT_PRODUCT_TYPE, MEAT_STATUS } = require('../../../../constants/production');
const { normalizeForSearch } = require('../../../../utils/vietnamese');

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    cattleId: { type: ObjectId, ref: 'Cattle', required: true },
    cattleCode: { type: String, required: true, trim: true, uppercase: true },
    weightKg: { type: Number, required: true, min: 0.01 }, // Trọng lượng xuất
    exportDate: { type: Date, required: true }, // 00:00 GMT+7
    productType: { type: String, enum: Object.values(MEAT_PRODUCT_TYPE) },
    batchCode: { type: String, required: true, trim: true, uppercase: true }, // Lô sản xuất

    // Khi lô được xuất sang Kho sản phẩm đầu ra (module output-products gọi markBatchTransferred) thì khóa sửa/xóa
    status: { type: String, enum: Object.values(MEAT_STATUS), default: MEAT_STATUS.DRAFT },
    transferredAt: Date,
    outputProductId: { type: ObjectId, ref: 'OutputProduct' },

    createdBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
    deletedBy: { type: ObjectId, ref: 'User' },
    searchText: { type: String, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

schema.pre('validate', function prep() {
  this.searchText = normalizeForSearch([this.cattleCode, this.batchCode].filter(Boolean).join(' '));
});

schema.index({ deletedAt: 1, exportDate: -1 });
schema.index({ batchCode: 1, status: 1 });
schema.index({ cattleId: 1, exportDate: -1 });

module.exports = mongoose.model('MeatRecord', schema);