'use strict';
const ApiError = require('../../../utils/ApiError');
const Cattle = require('../cattle/cattle.model');
const CattleStatusHistory = require('../cattle/cattleStatusHistory.model');

const HOUR_MS = 3600 * 1000;
const fieldError = (field, message, code = 'VALIDATION_ERROR') =>
  ApiError.unprocessable('Dữ liệu không hợp lệ', [{ field: `body.${field}`, message }], code);
const hoursSince = (date, now = new Date()) => (now - new Date(date)) / HOUR_MS;

async function findCattleByCode(code) {
  const c = await Cattle.findOne({ code });
  if (!c) throw fieldError('cattleCode', `Không tìm thấy bò có mã "${code}"`, 'CATTLE_NOT_FOUND');
  return c;
}

const addDaysYmd = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 24 * HOUR_MS).toISOString().slice(0, 10);
const daysBetweenYmd = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (24 * HOUR_MS));

// Đổi trạng thái bò (đọc lại bản mới nhất trong transaction). Trả null nếu trạng thái hiện tại không thuộc allowedFrom.
async function moveCattleStatus(cattleId, { to, allowedFrom, reason, effectiveDate, actorId, session }) {
  const c = await Cattle.findOne({ _id: cattleId }).session(session);
  if (!c || !allowedFrom.includes(c.status)) return null;
  const from = c.status;
  c.status = to;
  c.statusChangedAt = new Date();
  await c.save({ session });
  await CattleStatusHistory.create([{ cattleId: c._id, from, to, effectiveDate, reason, changedBy: actorId }], { session });
  return { from, to };
}

module.exports = { fieldError, hoursSince, findCattleByCode, addDaysYmd, daysBetweenYmd, moveCattleStatus };