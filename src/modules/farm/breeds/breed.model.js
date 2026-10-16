'use strict';
const mongoose = require('mongoose');
const { BREED_STATUS } = require('../../../constants/farm');
const { normalizeForSearch } = require('../../../utils/vietnamese');

const breedSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameKey: { type: String, required: true }, // tên viết thường: unique không phân biệt hoa/thường
    description: { type: String, trim: true },
    characteristics: { type: String, trim: true }, // Đặc điểm
    image: { type: String, trim: true }, // URL/đường dẫn ảnh đại diện
    status: { type: String, enum: Object.values(BREED_STATUS), default: BREED_STATUS.ACTIVE },
    hiddenAt: Date,
    searchText: { type: String, select: false },
  },
  { timestamps: true }
);

breedSchema.pre('validate', function prep() {
  if (this.name) {
    this.nameKey = this.name.trim().toLowerCase();
    this.searchText = normalizeForSearch(this.name);
  }
});
breedSchema.index({ nameKey: 1 }, { unique: true });
breedSchema.index({ status: 1, name: 1 });

module.exports = mongoose.model('Breed', breedSchema);
