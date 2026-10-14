'use strict';
const { z } = require('zod');
const { normalizeForSearch, escapeRegex } = require('./vietnamese');
const { startOfDayVN, endOfDayVN } = require('./datetime');

// Phân trang chuẩn BRD: 20 bản ghi/trang, tùy chọn 10/20/50
const PAGE_SIZES = [10, 20, 50];
const paginationShape = {
  page: z.coerce.number().int().min(1, 'page phải ≥ 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .refine((v) => PAGE_SIZES.includes(v), 'limit chỉ nhận 10, 20 hoặc 50')
    .default(20),
};

// Tìm contains, không phân biệt hoa/thường, bỏ dấu. Cần field searchText (xem user.model)
const searchFilter = (keyword) => {
  const k = normalizeForSearch(keyword);
  return k ? { searchText: { $regex: escapeRegex(k) } } : null;
};

// from/to dạng YYYY-MM-DD, bao gồm cả hai đầu mút, theo GMT+7
const dateRangeFilter = (field, from, to) => {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = startOfDayVN(from);
  if (to) range.$lte = endOfDayVN(to);
  return { [field]: range };
};

// Thêm _id để thứ tự ổn định khi trùng giá trị sắp xếp
const buildSort = (field, order) => {
  const dir = order === 'asc' ? 1 : -1;
  return field === '_id' ? { _id: dir } : { [field]: dir, _id: dir };
};

const andFilter = (...parts) => {
  const list = parts.filter(Boolean);
  return list.length === 1 ? list[0] : { $and: list };
};

async function paginate(Model, { filter, sort, page, limit }) {
  const [items, total] = await Promise.all([
    Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Model.countDocuments(filter),
  ]);
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

module.exports = { PAGE_SIZES, paginationShape, searchFilter, dateRangeFilter, buildSort, andFilter, paginate };
