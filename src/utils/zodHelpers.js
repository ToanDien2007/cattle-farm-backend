'use strict';
const { z } = require('zod');
const { isValidYmd } = require('./datetime');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID không hợp lệ');
const dateOnly = z.string().refine(isValidYmd, 'Ngày phải theo dạng YYYY-MM-DD');
const emptyToUndef = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

// "a,b,c" -> ['a','b','c'] (multi-select), kiểm tra thuộc danh sách cho phép
const csvEnum = (values) =>
  z.string().transform((s, ctx) => {
    const items = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
    const bad = items.filter((x) => !values.includes(x));
    if (bad.length) {
      ctx.addIssue({ code: 'custom', message: `Giá trị không hợp lệ: ${bad.join(', ')}` });
      return z.NEVER;
    }
    return items;
  });

// "id1,id2" -> ['id1','id2'] (multi-select theo ID)
const csvObjectIds = z.string().transform((s, ctx) => {
  const items = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
  if (items.some((x) => !/^[0-9a-fA-F]{24}$/.test(x))) {
    ctx.addIssue({ code: 'custom', message: 'Danh sách ID không hợp lệ' });
    return z.NEVER;
  }
  return items;
});

// Số dương (nhận số hoặc chuỗi số, dấu phẩy thập phân), làm tròn `decimals` chữ số bằng decimal.js
const Decimal = require('decimal.js');
const positiveNumber = (message, decimals = 2) =>
  z.any().transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return new Decimal(n).toDecimalPlaces(decimals).toNumber();
  });

const csvStrings = z.string().transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]);

module.exports = { positiveNumber, csvStrings, csvObjectIds, objectId, dateOnly, csvEnum, emptyToUndef };
