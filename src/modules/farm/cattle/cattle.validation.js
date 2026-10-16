'use strict';
const { z } = require('zod');
const { SEX, ORIGIN, CATTLE_STATUS, REMOVAL_TYPE } = require('../../../constants/cattleStatus');
const { objectId, csvEnum, csvObjectIds, dateOnly, positiveNumber } = require('../../../utils/zodHelpers');
const { paginationShape } = require('../../../utils/listQuery');
const { todayYmdVN } = require('../../../utils/datetime');

const idParam = z.object({ id: objectId });
const sessionParam = z.object({ sessionId: objectId });
const upper = (s) => s.toUpperCase();
const optText = (max) => z.string().trim().max(max).optional(); // '' = xóa giá trị

const notFuture = (msg) => (v) => v <= todayYmdVN() || msg;
const birthDate = dateOnly.refine((v) => v <= todayYmdVN(), 'Ngày sinh không được lớn hơn ngày hiện tại');

const fields = {
  code: z.string().trim().min(1, 'Bắt buộc nhập mã bò').max(50, 'Mã bò tối đa 50 ký tự').transform(upper),
  earTag: z.string().trim().min(1, 'Bắt buộc nhập số tai/RFID').max(50).transform(upper),
  name: optText(100),
  breedId: objectId,
  sex: z.enum(Object.values(SEX), { error: 'Giới tính phải là MALE hoặc FEMALE' }),
  birthDate,
  weightKg: positiveNumber('Trọng lượng phải là số > 0'),
  penId: objectId,
  origin: z.enum(Object.values(ORIGIN), { error: 'Nguồn gốc phải là BORN hoặc PURCHASED' }).optional(),
  joinDate: dateOnly,
  image: optText(500),
  note: optText(1000),
};

const joinAfterBirth = (d, ctx) => {
  if (d.joinDate && d.birthDate && d.joinDate < d.birthDate) {
    ctx.addIssue({ code: 'custom', path: ['joinDate'], message: 'Ngày nhập đàn phải ≥ Ngày sinh' });
  }
};

const create = z.object(fields).superRefine(joinAfterBirth);

// Sửa: gửi các trường cần đổi. code (nếu gửi) phải trùng Mã bò hiện tại: không cho sửa Mã bò sau khi tạo.
const update = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
    code: z.string().trim().optional(),
  })
  .superRefine(joinAfterBirth)
  .refine((d) => Object.keys(d).length > 0, 'Không có dữ liệu để cập nhật');

const filterShape = {
  q: z.string().trim().max(100).optional(), // mã bò, số tai/RFID, tên
  breedId: csvObjectIds.optional(),
  penId: csvObjectIds.optional(),
  sex: csvEnum(Object.values(SEX)).optional(),
  status: csvEnum(Object.values(CATTLE_STATUS)).optional(),
  ageMonthsMin: z.coerce.number().int().min(0).optional(),
  ageMonthsMax: z.coerce.number().int().min(0).optional(),
  weightMin: z.coerce.number().min(0).optional(),
  weightMax: z.coerce.number().min(0).optional(),
  joinedFrom: dateOnly.optional(), // theo khoảng thời gian (Ngày nhập đàn)
  joinedTo: dateOnly.optional(),
  sortBy: z.enum(['code', 'birthDate', 'weightKg', 'joinDate', 'updatedAt']).default('code'),
  order: z.enum(['asc', 'desc']).default('asc'),
};
const ranges = (d, ctx) => {
  const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (d.ageMonthsMin != null && d.ageMonthsMax != null && d.ageMonthsMin > d.ageMonthsMax) bad('ageMonthsMax', 'Tuổi tối thiểu phải ≤ tuổi tối đa');
  if (d.weightMin != null && d.weightMax != null && d.weightMin > d.weightMax) bad('weightMax', 'Trọng lượng tối thiểu phải ≤ tối đa');
  if (d.joinedFrom && d.joinedTo && d.joinedFrom > d.joinedTo) bad('joinedTo', 'Ngày bắt đầu phải ≤ ngày kết thúc');
};

const list = z.object({ ...paginationShape, ...filterShape }).superRefine(ranges);
const exportQuery = z
  .object({ ...filterShape, format: z.enum(['xlsx', 'csv']).default('xlsx'), scope: z.enum(['filtered', 'all']).default('filtered') })
  .superRefine(ranges);

const bulkDelete = z.object({
  ids: z.array(objectId).min(1, 'Chọn ít nhất 1 bò').max(100, 'Tối đa 100 bò mỗi lần').transform((a) => [...new Set(a)]),
});

const movePen = z.object({ penId: objectId, note: optText(500) });

const pedigree = z
  .object({
    sireCode: z.string().trim().max(50).nullable().optional(), // null hoặc '' = bỏ liên kết
    damCode: z.string().trim().max(50).nullable().optional(),
  })
  .refine((d) => d.sireCode !== undefined || d.damCode !== undefined, 'Cần gửi sireCode và/hoặc damCode');
const pedigreeTree = z.object({ depth: z.coerce.number().int().min(1).max(5).default(3) });

const changeStatus = z
  .object({
    newStatus: z.enum([CATTLE_STATUS.SOLD, CATTLE_STATUS.DEAD, CATTLE_STATUS.REMOVED], { error: 'Trạng thái mới phải là SOLD, DEAD hoặc REMOVED' }),
    removalType: z.enum(Object.values(REMOVAL_TYPE)).optional(), // bắt buộc khi REMOVED: CULLED (Loại thải) | SHIPPED_OUT (Xuất chuồng)
    effectiveDate: dateOnly.refine((v) => v <= todayYmdVN(), 'Ngày chuyển không được ở tương lai'),
    reason: optText(500),
    note: optText(1000),
  })
  .superRefine((d, ctx) => {
    const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (d.newStatus === CATTLE_STATUS.REMOVED && !d.removalType) bad('removalType', 'Chọn Xuất chuồng (SHIPPED_OUT) hoặc Loại thải (CULLED)');
    if (d.newStatus !== CATTLE_STATUS.REMOVED && d.removalType) bad('removalType', 'removalType chỉ dùng khi newStatus = REMOVED');
    if ((d.newStatus === CATTLE_STATUS.DEAD || d.removalType === REMOVAL_TYPE.CULLED) && !d.reason) bad('reason', 'Bắt buộc nhập lý do khi chuyển sang Đã chết/Loại thải');
  });

const importConfirm = z.object({ sessionId: objectId });

module.exports = { idParam, sessionParam, fields, create, update, list, exportQuery, bulkDelete, movePen, pedigree, pedigreeTree, changeStatus, importConfirm, notFuture };
