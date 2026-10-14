'use strict';
const ApiError = require('../../utils/ApiError');
const ROLES = require('../../constants/roles');
const AUDIT = require('../../constants/auditActions');
const User = require('../users/user.model');
const { hashPassword, buildSearchText, statusOf, statusFilter, generateTempPassword } = require('../users/user.service');
const { revokeSessions } = require('../auth/auth.service');
const { sendTempPassword } = require('../../integrations/mailer/mailer.service');
const audit = require('../../shared/audit/auditLog.service');
const { paginate, searchFilter, buildSort, andFilter } = require('../../utils/listQuery');

const MODULE = 'accounts';
const scope = () => ({ role: ROLES.ADMIN, deletedAt: null }); // tài khoản nhân sự = ADMIN, chưa xóa

const toItem = (u) => ({
  id: u._id,
  username: u.email, // "Tên đăng nhập" trong BRD = email đăng nhập
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: statusOf(u),
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'ACCOUNT_NOT_FOUND');
const conflict = () => ApiError.conflict('Tài khoản đã bị xóa/khóa trong lúc thao tác, vui lòng tải lại', 'RECORD_CONFLICT');

async function list(q) {
  const filter = andFilter(scope(), searchFilter(q.q), statusFilter(q.status), q.role && { role: { $in: q.role } });
  const res = await paginate(User, { filter, sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  return { ...res, items: res.items.map(toItem) };
}

async function getById(id) {
  const user = await User.findOne({ _id: id, ...scope() }).lean();
  if (!user) throw notFound();
  return toItem(user);
}

async function create(req, body) {
  if (await User.exists({ email: body.email })) throw ApiError.conflict('Email đã được sử dụng', 'EMAIL_TAKEN');
  if (body.phone && (await User.exists({ phone: body.phone }))) throw ApiError.conflict('SĐT đã được sử dụng', 'PHONE_TAKEN');

  const tempPassword = generateTempPassword();
  const user = await User.create({
    fullName: body.fullName,
    email: body.email,
    phone: body.phone,
    role: body.role,
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true, // bắt buộc đổi mật khẩu ở lần đăng nhập đầu
    isVerified: true,
  });

  try {
    await sendTempPassword(user, tempPassword);
  } catch (err) {
    console.error('Gửi mật khẩu tạm thất bại:', err.message);
    await User.deleteOne({ _id: user._id }); // chưa ai biết mật khẩu -> hoàn tác
    throw new ApiError(502, 'EMAIL_SEND_FAILED', 'Không gửi được email mật khẩu tạm, tài khoản chưa được tạo. Vui lòng thử lại');
  }

  const item = toItem(user);
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'User', entityId: user._id, after: item });
  return item;
}

async function update(req, id, body) {
  const current = await User.findOne({ _id: id, ...scope() });
  if (!current) throw notFound();
  if (current.isLocked) throw conflict();

  if (body.email && body.email !== current.email && (await User.exists({ email: body.email, _id: { $ne: id } }))) {
    throw ApiError.conflict('Email đã được sử dụng', 'EMAIL_TAKEN');
  }
  if (body.phone && body.phone !== current.phone && (await User.exists({ phone: body.phone, _id: { $ne: id } }))) {
    throw ApiError.conflict('SĐT đã được sử dụng', 'PHONE_TAKEN');
  }

  const set = {};
  if (body.fullName !== undefined) set.fullName = body.fullName;
  if (body.email !== undefined) set.email = body.email;
  if (body.phone) set.phone = body.phone;
  const merged = {
    fullName: set.fullName ?? current.fullName,
    email: set.email ?? current.email,
    phone: body.phone === null ? undefined : set.phone ?? current.phone,
  };
  set.searchText = buildSearchText(merged); // findOneAndUpdate không chạy hook nên phải tự cập nhật
  const update = { $set: set };
  if (body.phone === null) update.$unset = { phone: 1 };

  // Điều kiện nằm trong câu lệnh để phát hiện bản ghi bị xóa/khóa giữa chừng
  const updated = await User.findOneAndUpdate({ _id: id, ...scope(), isLocked: false }, update, { new: true });
  if (!updated) throw conflict();

  const after = toItem(updated);
  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'User', entityId: id, before: toItem(current), after });
  return after;
}

// Xóa mềm (1 hoặc nhiều): deletedAt + isLocked => hiển thị 'Đã khóa', giữ lịch sử thao tác
async function remove(req, ids) {
  const targets = await User.find({ _id: { $in: ids }, ...scope() });
  if (targets.length !== ids.length) {
    const found = new Set(targets.map((t) => String(t._id)));
    throw ApiError.notFound('Có tài khoản không tồn tại hoặc đã bị xóa', 'ACCOUNT_NOT_FOUND', ids.filter((i) => !found.has(i)));
  }
  if (ids.includes(String(req.user._id))) throw ApiError.conflict('Không thể tự xóa tài khoản của chính mình', 'CANNOT_DELETE_SELF');

  const activeAdmins = await User.countDocuments({ ...scope(), isLocked: false });
  const removingActive = targets.filter((t) => !t.isLocked).length;
  if (activeAdmins - removingActive < 1) {
    throw ApiError.conflict('Không thể xóa: hệ thống phải còn ít nhất 1 quản trị viên hoạt động', 'LAST_ADMIN');
  }

  const now = new Date();
  await User.updateMany({ _id: { $in: ids }, ...scope() }, { $set: { deletedAt: now, isLocked: true, lockedAt: now } });
  await revokeSessions(ids);
  for (const t of targets) {
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'User', entityId: t._id, before: toItem(t), after: { status: 'LOCKED', deletedAt: now } });
  }
  return { deleted: ids.length };
}

module.exports = { list, getById, create, update, remove };
