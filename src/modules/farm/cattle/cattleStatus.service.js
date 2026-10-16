'use strict';
const ApiError = require('../../../utils/ApiError');
const AUDIT = require('../../../constants/auditActions');
const { CATTLE_STATUS, CATTLE_STATUS_LABEL, TRANSITIONABLE_FROM, NON_OPERABLE } = require('../../../constants/cattleStatus');
const Cattle = require('./cattle.model');
const CattleStatusHistory = require('./cattleStatusHistory.model');
const audit = require('../../../shared/audit/auditLog.service');
const { withTransaction } = require('../../../utils/transaction');
const { startOfDayVN, ymdOf } = require('../../../utils/datetime');

// Dùng cho module khác (sản lượng, tiêm phòng...): bò đã bán/chết/không còn trong đàn thì chặn ghi nhận mới
function assertOperable(cattle) {
  if (NON_OPERABLE.includes(cattle.status)) {
    throw ApiError.conflict(`Bò ${cattle.code} đang ở trạng thái "${CATTLE_STATUS_LABEL[cattle.status]}", không thể ghi nhận thêm nghiệp vụ`, 'CATTLE_NOT_OPERABLE');
  }
}

// Chuyển trạng thái: Bán / Chết / Xuất chuồng / Loại thải. Chỉ từ Đang nuôi hoặc Đang điều trị.
async function changeStatus(req, id, body) {
  const c = await Cattle.findOne({ _id: id });
  if (!c) throw ApiError.notFound('Không tìm thấy dữ liệu', 'CATTLE_NOT_FOUND');
  if (!TRANSITIONABLE_FROM.includes(c.status)) {
    throw ApiError.conflict(`Chỉ bò "Đang nuôi" hoặc "Đang điều trị" mới được chuyển trạng thái (hiện tại: ${CATTLE_STATUS_LABEL[c.status]})`, 'INVALID_STATUS_TRANSITION');
  }
  if (body.effectiveDate < ymdOf(c.joinDate)) {
    throw ApiError.unprocessable('Dữ liệu không hợp lệ', [{ field: 'body.effectiveDate', message: 'Ngày chuyển phải ≥ Ngày nhập đàn' }]);
  }

  const from = c.status;
  const effectiveDate = startOfDayVN(body.effectiveDate);
  await withTransaction(async (session) => {
    c.status = body.newStatus;
    c.statusChangedAt = new Date();
    c.exit = { date: effectiveDate, removalType: body.removalType, reason: body.reason };
    await c.save({ session });
    await CattleStatusHistory.create(
      [{ cattleId: c._id, from, to: body.newStatus, removalType: body.removalType, effectiveDate, reason: body.reason, note: body.note, changedBy: req.user._id }],
      { session }
    );
  });

  await audit.record(req, {
    action: AUDIT.STATUS_CHANGE, module: 'cattle', entity: 'Cattle', entityId: id,
    before: { status: from },
    after: { status: c.status, removalType: body.removalType, reason: body.reason, effectiveDate: body.effectiveDate },
  });
  return { id: c._id, code: c.code, status: c.status, statusChangedAt: c.statusChangedAt, exit: c.exit };
}

module.exports = { assertOperable, changeStatus, CATTLE_STATUS };
