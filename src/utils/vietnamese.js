'use strict';

// "Nguyễn Văn Đức" -> "nguyen van duc" (dùng cho tìm kiếm không phân biệt hoa/thường, bỏ dấu)
const normalizeForSearch = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { normalizeForSearch, escapeRegex };
