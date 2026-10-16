'use strict';
const { z } = require('zod');
const { QUARANTINE_STATUS, QUARANTINE_OUTCOME } = require('../../../../constants/health');
const { objectId, csvEnum, dateOnly } = require('../../../../utils/zodHelpers');
const { paginationShape } = require('../../../../utils/listQuery');
const { todayYmdVN } = require('../../../../utils/datetime');

const idParam = z.object({ id: objectId });
const notFuture = () => (v) => v <= todayYmdVN();

const start = z
  .object({
    cattleCode: z.string().trim().min(1, 'Bắt buộc nhập mã bò').max(50).transform((s) => s.toUpperCase()),
    disease: z.string().trim().min(1, 'Bắt buộc nhập bệnh được chẩn đoán').max(200, 'Tối đa 200 ký tự'),
    startDate: dateOnly.refine(notFuture(), 'Ngày cách ly không được lớn hơn ngày hiện tại'),
    expectedRecoveryDate: dateOnly.optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((d) => !d.expectedRecoveryDate || d.expectedRecoveryDate >= d.startDate, { path: ['expectedRecoveryDate'], message: 'Ngày dự kiến khỏi phải ≥ Ngày cách ly' });

const end = z.object({
  endDate: dateOnly.refine(notFuture(), 'Ngày kết thúc không được lớn hơn ngày hiện tại').optional(), // mặc định hôm nay
  outcome: z.enum(Object.values(QUARANTINE_OUTCOME), { error: 'Kết quả phải là RECOVERED hoặc CONTINUE_TREATMENT' }).default(QUARANTINE_OUTCOME.RECOVERED),
  note: z.string().trim().max(1000).optional(),
});

const addNote = z.object({ note: z.string().trim().min(1, 'Bắt buộc nhập nội dung diễn biến').max(1000) });

const list = z
  .object({
    ...paginationShape,
    q: z.string().trim().max(100).optional(), // mã bò, bệnh
    cattleCode: z.string().trim().max(50).transform((s) => s.toUpperCase()).optional(),
    status: csvEnum(Object.values(QUARANTINE_STATUS)).optional(),
    startFrom: dateOnly.optional(),
    startTo: dateOnly.optional(),
    sortBy: z.enum(['startDate', 'createdAt']).default('startDate'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((d) => !(d.startFrom && d.startTo) || d.startFrom <= d.startTo, { path: ['startTo'], message: 'Ngày bắt đầu phải ≤ ngày kết thúc' });

module.exports = { idParam, start, end, addNote, list };