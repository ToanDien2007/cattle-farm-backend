'use strict';
const { z } = require('zod');
const { MEAT_PRODUCT_TYPE } = require('../../../../constants/production');
const { objectId, csvEnum, dateOnly, positiveNumber } = require('../../../../utils/zodHelpers');
const { paginationShape } = require('../../../../utils/listQuery');

const idParam = z.object({ id: objectId });
const upper = (s) => s.toUpperCase();
const productType = z.enum(Object.values(MEAT_PRODUCT_TYPE), { error: 'Loại sản phẩm phải là FRESH (Thịt tươi) hoặc PROCESSED (Thịt chế biến)' });

const fields = {
  cattleCode: z.string().trim().min(1, 'Bắt buộc nhập mã bò').max(50, 'Mã bò tối đa 50 ký tự').transform(upper),
  weightKg: positiveNumber('Trọng lượng xuất phải là số lớn hơn 0'),
  exportDate: dateOnly,
  productType: productType.optional(),
  batchCode: z.string().trim().min(1, 'Bắt buộc nhập lô sản xuất').max(50, 'Lô sản xuất tối đa 50 ký tự').transform(upper),
};

const create = z.object(fields);

// Sửa: chỉ gửi trường cần đổi; cattleCode (nếu gửi) phải trùng bò hiện tại; productType = null để xóa
const update = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
    cattleCode: z.string().trim().optional().transform((s) => s?.toUpperCase()),
    productType: productType.nullable().optional(),
  })
  .refine((d) => Object.values(d).some((x) => x !== undefined), 'Không có dữ liệu để cập nhật');

const filterShape = {
  q: z.string().trim().max(100).optional(), // mã bò, lô sản xuất
  cattleCode: z.string().trim().max(50).transform(upper).optional(),
  batchCode: z.string().trim().max(50).transform(upper).optional(), // xuất theo lô
  productType: csvEnum(Object.values(MEAT_PRODUCT_TYPE)).optional(),
  dateFrom: dateOnly.optional(), // theo Ngày xuất
  dateTo: dateOnly.optional(),
  sortBy: z.enum(['exportDate', 'weightKg']).default('exportDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
};
const ranges = (d, ctx) => {
  if (d.dateFrom && d.dateTo && d.dateFrom > d.dateTo) ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Ngày bắt đầu phải ≤ ngày kết thúc' });
};

const list = z.object({ ...paginationShape, ...filterShape }).superRefine(ranges);
const exportQuery = z
  .object({ ...filterShape, format: z.enum(['xlsx', 'csv']).default('xlsx'), scope: z.enum(['filtered', 'all']).default('filtered') })
  .superRefine(ranges);
const bulkDelete = z.object({
  ids: z.array(objectId).min(1, 'Chọn ít nhất 1 bản ghi').max(100, 'Tối đa 100 bản ghi mỗi lần').transform((a) => [...new Set(a)]),
});

module.exports = { idParam, create, update, list, exportQuery, bulkDelete };