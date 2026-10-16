'use strict';
const ApiError = require('../../../utils/ApiError');
const { IN_HERD, NON_OPERABLE } = require('../../../constants/cattleStatus');
const { NEARLY_FULL_PERCENT, PEN_FILL } = require('../../../constants/farm');
const Pen = require('./pen.model');
const PenAssignment = require('./penAssignment.model');
const Cattle = require('../cattle/cattle.model');

// Số bò đang ở trong từng chuồng (chỉ bò còn trong đàn). Trả { penId: count }
async function occupancy(penIds) {
  const match = { status: { $in: IN_HERD } };
  match.penId = penIds ? { $in: penIds } : { $ne: null };
  const rows = await Cattle.aggregate([{ $match: match }, { $group: { _id: '$penId', count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
}

const fillStatus = (count, capacity) =>
  count >= capacity ? PEN_FILL.FULL : count * 100 >= capacity * NEARLY_FULL_PERCENT ? PEN_FILL.NEARLY_FULL : PEN_FILL.AVAILABLE;

const fillPercent = (count, capacity) => Math.round((count * 1000) / capacity) / 10;

// Kiểm tra chuồng đích còn chỗ. Hết chỗ => chặn. Sau khi nhận đạt ≥90% => trả cảnh báo (không chặn).
// extra: số bò sẽ được thêm trước đó trong cùng đợt (import)
async function checkPenCapacity(penId, { extra = 0, session } = {}) {
  const pen = await Pen.findOne({ _id: penId, deletedAt: null }).session(session || null);
  if (!pen) throw ApiError.unprocessable('Chuồng không tồn tại hoặc đã bị xóa', [{ field: 'penId', message: 'Chuồng không tồn tại' }], 'PEN_NOT_FOUND');

  const used = ((await occupancy([pen._id]))[String(pen._id)] || 0) + extra;
  if (used >= pen.capacity) {
    throw ApiError.conflict(`Chuồng ${pen.code} đã đầy (${used}/${pen.capacity})`, 'PEN_FULL');
  }
  const after = used + 1;
  const warning =
    after * 100 >= pen.capacity * NEARLY_FULL_PERCENT
      ? { code: 'PEN_NEARLY_FULL', message: `Chuồng ${pen.code} sẽ đạt ${fillPercent(after, pen.capacity)}% sức chứa (${after}/${pen.capacity})` }
      : null;
  return { pen, warning };
}

// Ghi lịch sử phân bổ (gọi trong transaction)
const recordAssignment = ({ cattleId, fromPenId, toPenId, movedBy, note }, session) =>
  PenAssignment.create([{ cattleId, fromPenId, toPenId, movedBy, note, movedAt: new Date() }], { session });

// Chuyển bò sang chuồng khác (gọi trong transaction). Không ghi gì nếu cùng chuồng.
async function moveCattle(cattle, toPenId, { movedBy, note, session }) {
  if (NON_OPERABLE.includes(cattle.status)) {
    throw ApiError.conflict('Bò không còn trong đàn hoặc đã bán/chết, không thể chuyển chuồng', 'CATTLE_NOT_OPERABLE');
  }
  if (String(cattle.penId) === String(toPenId)) throw ApiError.conflict('Bò đang ở chuồng này', 'SAME_PEN');

  const { pen, warning } = await checkPenCapacity(toPenId, { session });
  const fromPenId = cattle.penId;
  cattle.penId = pen._id;
  await cattle.save({ session });
  await recordAssignment({ cattleId: cattle._id, fromPenId, toPenId: pen._id, movedBy, note }, session);
  return { pen, warning };
}

module.exports = { occupancy, fillStatus, fillPercent, checkPenCapacity, recordAssignment, moveCattle };
