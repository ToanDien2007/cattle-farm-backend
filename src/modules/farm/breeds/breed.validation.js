'use strict';
const { z } = require('zod');
const { BREED_STATUS } = require('../../../constants/farm');
const { objectId, csvEnum } = require('../../../utils/zodHelpers');
const { paginationShape } = require('../../../utils/listQuery');

const idParam = z.object({ id: objectId });
const optText = (max) => z.string().trim().max(max).optional();

const fields = {
  name: z.string().trim().min(1, 'Bắt buộc nhập tên giống').max(100, 'Tên giống tối đa 100 ký tự'),
  description: optText(2000),
  characteristics: optText(2000),
  image: optText(500),
};

const create = z.object(fields);
const update = z.object(fields); // Sửa: gửi đủ các trường như form (Tên giống bắt buộc)

const list = z.object({
  ...paginationShape,
  q: z.string().trim().max(100).optional(),
  status: csvEnum(Object.values(BREED_STATUS)).optional(),
  sortBy: z.enum(['name', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const bulkDelete = z.object({
  ids: z.array(objectId).min(1, 'Chọn ít nhất 1 giống bò').max(100, 'Tối đa 100 giống mỗi lần').transform((a) => [...new Set(a)]),
});

module.exports = { idParam, create, update, list, bulkDelete };
