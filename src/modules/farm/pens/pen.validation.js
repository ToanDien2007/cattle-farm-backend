'use strict';
const { z } = require('zod');
const { PEN_FILL } = require('../../../constants/farm');
const { objectId, csvEnum, csvStrings } = require('../../../utils/zodHelpers');
const { paginationShape } = require('../../../utils/listQuery');

const idParam = z.object({ id: objectId });
const capacity = z.any().transform((v, ctx) => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (!Number.isInteger(n) || n <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Sức chứa phải là số nguyên dương' });
    return z.NEVER;
  }
  return n;
});

const create = z.object({
  code: z.string().trim().min(1, 'Bắt buộc nhập mã chuồng').max(50).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, 'Bắt buộc nhập tên chuồng').max(100),
  capacity,
  zone: z.string().trim().min(1, 'Bắt buộc nhập khu vực').max(100),
  type: z.string().trim().max(100).optional(),
});

const update = z
  .object({
    code: create.shape.code.optional(),
    name: create.shape.name.optional(),
    capacity: capacity.optional(),
    zone: create.shape.zone.optional(),
    type: z.string().trim().max(100).optional(), // '' = xóa
  })
  .refine((d) => Object.keys(d).length > 0, 'Không có dữ liệu để cập nhật');

const list = z.object({
  ...paginationShape,
  q: z.string().trim().max(100).optional(), // mã chuồng, tên chuồng
  zone: csvStrings.optional(),
  type: csvStrings.optional(),
  fill: csvEnum(Object.values(PEN_FILL)).optional(), // Còn chỗ / Gần đầy (≥90%) / Đầy
  sortBy: z.enum(['code', 'capacity', 'fillPercent']).default('code'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const bulkDelete = z.object({
  ids: z.array(objectId).min(1, 'Chọn ít nhất 1 chuồng').max(100).transform((a) => [...new Set(a)]),
});

module.exports = { idParam, create, update, list, bulkDelete };
