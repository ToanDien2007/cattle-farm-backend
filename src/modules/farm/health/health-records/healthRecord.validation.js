'use strict';
const { z } = require('zod');
const { CONCLUSION } = require('../../../../constants/health');
const { objectId, csvEnum, dateOnly, positiveNumber } = require('../../../../utils/zodHelpers');
const { paginationShape } = require('../../../../utils/listQuery');
const { todayYmdVN } = require('../../../../utils/datetime');

const idParam = z.object({ id: objectId });
const upper = (s) => s.toUpperCase();
const optText = (max) => z.string().trim().max(max).optional(); // '' = xóa giá trị

const fields = {
  cattleCode: z.string().trim().min(1, 'Bắt buộc nhập mã bò').max(50, 'Mã bò tối đa 50 ký tự').transform(upper),
  examDate: dateOnly.refine((v) => v <= todayYmdVN(), 'Ngày khám không được lớn hơn ngày hiện tại'),
  symptoms: optText(1000),
  diagnosis: optText(500),
  treatment: optText(1000),
  medication: optText(500),
  weightKg: positiveNumber('Cân nặng phải là số > 0').optional(),
  performedBy: z.string().trim().min(1, 'Bắt buộc nhập người thực hiện').max(100),
  conclusion: z.enum(Object.values(CONCLUSION), { error: 'Kết luận phải là HEALTHY, MONITORING hoặc SICK' }).optional(),
};

const create = z.object(fields);

// Sửa: chỉ gửi trường cần đổi. cattleCode (nếu gửi) phải trùng bò hiện tại.
// Quá 24h kể từ khi tạo: bắt buộc confirmAmendment = true và amendReason.
const META = ['confirmAmendment', 'amendReason'];
const update = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
    cattleCode: z.string().trim().optional().transform((s) => s?.toUpperCase()),
    confirmAmendment: z.boolean().optional(),
    amendReason: optText(500),
  })
  .refine((d) => Object.keys(d).some((k) => !META.includes(k) && d[k] !== undefined), 'Không có dữ liệu để cập nhật');

const filterShape = {
  q: z.string().trim().max(100).optional(), // mã bò, chẩn đoán
  cattleCode: z.string().trim().max(50).transform(upper).optional(), // 1 cá thể
  conclusion: csvEnum(Object.values(CONCLUSION)).optional(),
  examFrom: dateOnly.optional(),
  examTo: dateOnly.optional(),
  sortBy: z.enum(['examDate', 'createdAt']).default('examDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
};
const ranges = (d, ctx) => {
  if (d.examFrom && d.examTo && d.examFrom > d.examTo) ctx.addIssue({ code: 'custom', path: ['examTo'], message: 'Ngày bắt đầu phải ≤ ngày kết thúc' });
};

const list = z.object({ ...paginationShape, ...filterShape }).superRefine(ranges);
const exportQuery = z
  .object({ ...filterShape, format: z.enum(['xlsx', 'csv']).default('xlsx'), scope: z.enum(['filtered', 'all']).default('filtered') })
  .superRefine(ranges);

const bulkDelete = z.object({
  ids: z.array(objectId).min(1, 'Chọn ít nhất 1 hồ sơ').max(100, 'Tối đa 100 hồ sơ mỗi lần').transform((a) => [...new Set(a)]),
});

module.exports = { idParam, create, update, list, exportQuery, bulkDelete };