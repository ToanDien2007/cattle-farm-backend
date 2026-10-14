'use strict';
const ApiError = require('../../utils/ApiError');
const ROLES = require('../../constants/roles');
const AUDIT = require('../../constants/auditActions');
const STATUS = require('../../constants/accountStatus');
const User = require('../users/user.model');
const { statusOf, statusFilter } = require('../users/user.service');
const { revokeSessions } = require('../auth/auth.service');
const { sendAccountStatusNotice } = require('../../integrations/mailer/mailer.service');
const audit = require('../../shared/audit/auditLog.service');
const { sendExport, EXPORT_MAX_ROWS } = require('../../shared/export/excel.exporter');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../utils/listQuery');
const { formatDateTimeVN } = require('../../utils/datetime');

const MODULE = 'customers';
const scope = () => ({ role: ROLES.CUSTOMER, deletedAt: null });
const STATUS_LABEL = { [STATUS.ACTIVE]: 'Hoạt động', [STATUS.LOCKED]: 'Đã khóa', [STATUS.UNVERIFIED]: 'Chưa xác thực' };

const toItem = (u) => ({
  id: u._id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  totalSpent: u.stats?.totalSpent ?? 0,
  orderCount: u.stats?.orderCount ?? 0,
  status: statusOf(u),
  createdAt: u.createdAt,
});

const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'CUSTOMER_NOT_FOUND');
const SORT_FIELD = { createdAt: 'createdAt', totalSpent: 'stats.totalSpent' };

const buildFilter = (q) =>
  andFilter(scope(), searchFilter(q.q), statusFilter(q.status), dateRangeFilter('createdAt', q.registeredFrom, q.registeredTo));

async function list(q) {
  const res = await paginate(User, { filter: buildFilter(q), sort: buildSort(SORT_FIELD[q.sortBy], q.order), page: q.page, limit: q.limit });
  return { ...res, items: res.items.map(toItem) };
}

async function getById(id) {
  const u = await User.findOne({ _id: id, ...scope() }).lean();
  if (!u) throw notFound();
  return {
    ...toItem(u),
    lastLoginAt: u.lastLoginAt,
    lockReason: u.lockReason,
    lockedAt: u.lockedAt,
    // TODO: nạp lịch sử đơn hàng và đánh giá khi có module shop/orders và shop/reviews (BRD 8.8, Data Scope ALL)
    orders: [],
    reviews: [],
  };
}

async function exportCustomers(req, res, q) {
  const filter = q.scope === 'all' ? scope() : buildFilter(q);
  const users = await User.find(filter).sort(buildSort(SORT_FIELD[q.sortBy], q.order)).limit(EXPORT_MAX_ROWS + 1).lean(); // không chọn passwordHash
  const rows = users.map((u) => {
    const i = toItem(u);
    return {
      fullName: i.fullName,
      email: i.email || '',
      phone: i.phone || '',
      totalSpent: i.totalSpent,
      orderCount: i.orderCount,
      status: STATUS_LABEL[i.status],
      createdAt: formatDateTimeVN(i.createdAt),
    };
  });

  const result = await sendExport(res, {
    format: q.format,
    base: 'khach-hang',
    sheetName: 'Khách hàng',
    columns: [
      { header: 'Họ tên', key: 'fullName', width: 28 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'SĐT', key: 'phone', width: 16 },
      { header: 'Tổng chi tiêu (VND)', key: 'totalSpent', width: 20 },
      { header: 'Số đơn hàng', key: 'orderCount', width: 14 },
      { header: 'Trạng thái', key: 'status', width: 16 },
      { header: 'Ngày đăng ký', key: 'createdAt', width: 20 },
    ],
    rows,
  });
  await audit.record(req, {
    action: AUDIT.EXPORT,
    module: MODULE,
    entity: 'User',
    meta: { format: q.format, scope: q.scope, filter: q.scope === 'all' ? null : { q: q.q, status: q.status, registeredFrom: q.registeredFrom, registeredTo: q.registeredTo }, rows: result.rows, filename: result.filename },
  });
}

// Khóa/mở khóa. Khóa: không đăng nhập được, thu hồi phiên; đơn đang xử lý vẫn xử lý bình thường.
async function setLocked(req, id, locked, reason) {
  const current = await User.findOne({ _id: id, ...scope() });
  if (!current) throw notFound();
  if (current.isLocked === locked) {
    throw ApiError.conflict(locked ? 'Tài khoản đã bị khóa trước đó' : 'Tài khoản đang không bị khóa', locked ? 'ALREADY_LOCKED' : 'NOT_LOCKED');
  }

  const update = locked
    ? { $set: { isLocked: true, lockedAt: new Date(), ...(reason ? { lockReason: reason } : {}) } }
    : { $set: { isLocked: false }, $unset: { lockReason: 1, lockedAt: 1 } };
  const updated = await User.findOneAndUpdate({ _id: id, ...scope(), isLocked: !locked }, update, { new: true });
  if (!updated) throw ApiError.conflict('Trạng thái tài khoản vừa bị thay đổi, vui lòng tải lại', 'RECORD_CONFLICT');

  if (locked) await revokeSessions([id]);
  await audit.record(req, {
    action: locked ? AUDIT.LOCK : AUDIT.UNLOCK,
    module: MODULE,
    entity: 'User',
    entityId: id,
    before: { status: statusOf(current) },
    after: { status: statusOf(updated), reason: reason || null },
  });

  if (updated.email) {
    try {
      await sendAccountStatusNotice(updated, { locked, reason });
    } catch (err) {
      console.error('Gửi email thông báo khóa/mở khóa thất bại:', err.message); // không hủy thao tác đã thành công
    }
  }
  return toItem(updated);
}

module.exports = { list, getById, exportCustomers, setLocked };
