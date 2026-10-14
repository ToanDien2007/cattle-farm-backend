'use strict';
const { z } = require('zod');
const STATUS = require('../../constants/accountStatus');
const { objectId, csvEnum, dateOnly } = require('../../utils/zodHelpers');
const { paginationShape } = require('../../utils/listQuery');

const idParam = z.object({ id: objectId });

// Bộ lọc dùng chung cho danh sách và export
const filterShape = {
  q: z.string().trim().max(100).optional(),
  status: csvEnum(Object.values(STATUS)).optional(),
  registeredFrom: dateOnly.optional(),
  registeredTo: dateOnly.optional(),
  sortBy: z.enum(['createdAt', 'totalSpent']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
};
const rangeOk = (d) => !d.registeredFrom || !d.registeredTo || d.registeredFrom <= d.registeredTo;
const rangeMsg = { message: 'Ngày bắt đầu phải ≤ ngày kết thúc', path: ['registeredTo'] };

const list = z.object({ ...paginationShape, ...filterShape }).refine(rangeOk, rangeMsg);

// scope: filtered = theo bộ lọc hiện tại (gồm khoảng thời gian), all = toàn bộ
const exportQuery = z
  .object({ ...filterShape, format: z.enum(['xlsx', 'csv']).default('xlsx'), scope: z.enum(['filtered', 'all']).default('filtered') })
  .refine(rangeOk, rangeMsg);

const lock = z.object({ reason: z.string().trim().max(500, 'Lý do tối đa 500 ký tự').optional() });

module.exports = { idParam, list, exportQuery, lock };
