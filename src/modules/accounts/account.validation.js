'use strict';
const { z } = require('zod');
const ROLES = require('../../constants/roles');
const STATUS = require('../../constants/accountStatus');
const { objectId, csvEnum } = require('../../utils/zodHelpers');
const { paginationShape } = require('../../utils/listQuery');
const { normalizePhone } = require('../../utils/identifier');

const email = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .refine((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), 'Email không hợp lệ');

const phone = z
  .string()
  .trim()
  .transform((s, ctx) => {
    const p = normalizePhone(s);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'SĐT không hợp lệ' });
      return z.NEVER;
    }
    return p;
  });

// Hiện chỉ có vai trò ADMIN (BRD V-15 chưa định nghĩa thêm vai trò nhân sự)
const role = z.literal(ROLES.ADMIN, { error: 'Vai trò không hợp lệ' });

const idParam = z.object({ id: objectId });

const create = z.object({
  fullName: z.string().trim().min(1, 'Bắt buộc nhập họ tên'),
  email,
  phone: phone.optional(),
  role: role.default(ROLES.ADMIN),
});

const update = z
  .object({
    fullName: z.string().trim().min(1, 'Họ tên không được để trống').optional(),
    email: email.optional(),
    phone: phone.nullable().optional(), // null = xóa SĐT
    role: role.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Không có dữ liệu để cập nhật');

const list = z.object({
  ...paginationShape,
  q: z.string().trim().max(100).optional(),
  status: csvEnum(Object.values(STATUS)).optional(),
  role: csvEnum([ROLES.ADMIN]).optional(),
  sortBy: z.enum(['createdAt', 'fullName']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const bulkDelete = z.object({
  ids: z.array(objectId).min(1, 'Chọn ít nhất 1 tài khoản').max(100, 'Tối đa 100 tài khoản mỗi lần').transform((a) => [...new Set(a)]),
});

module.exports = { idParam, create, update, list, bulkDelete };
