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

module.exports = { objectId, dateOnly, csvEnum, emptyToUndef };
