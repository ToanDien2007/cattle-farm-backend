'use strict';
const ApiError = require('../../../../utils/ApiError');
const AUDIT = require('../../../../constants/auditActions');
const { MILK_SHIFT_LABEL, PRODUCTION_RULES } = require('../../../../constants/production');
const MilkRecord = require('./milkRecord.model');
const Cattle = require('../../cattle/cattle.model');
const Pen = require('../../pens/pen.model');
const { assertOperable } = require('../../cattle/cattleStatus.service');
const { assertNotQuarantined } = require('../../health/quarantine/quarantine.service');
const { fieldError, hoursSince, findCattleByCode } = require('../../health/health.common');
const referenceGuard = require('../../../../shared/referenceGuard');
const audit = require('../../../../shared/audit/auditLog.service');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../../../utils/listQuery');
const { startOfDayVN, ymdOf, todayYmdVN } = require('../../../../utils/datetime');

const MODULE = 'production';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'MILK_RECORD_NOT_FOUND');

referenceGuard.register('Cattle', 'bản ghi sản lượng sữa', async (ids) => {
  const rows = await MilkRecord.find({ cattleId: { $in: ids } }).select('cattleId').lean();
  const out = {};
  for (const r of rows) out[String(r.cattleId)] = (out[String(r.cattleId)] || 0) + 1;
  return out;
});

async function loadPens(rows) {
  const ids = [...new Set(rows.map((r) => String(r.penId)))];
  const pens = ids.length ? await Pen.find({ _id: { $in: ids } }).select('code name').lean() : [];
  return new Map(pens.map((p) => [String(p._id), { id: p._id, code: p.code, name: p.name }]));
}

const toItem = (r, pens) => ({
  id: r._id, cattle: { id: r.cattleId, code: r.cattleCode }, pen: pens?.get(String(r.penId)) ?? { id: r.penId },
  date: r.date, shift: r.shift, volumeLiters: r.volumeLiters, quality: r.quality ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
const snapshot = (r) => ({ cattleCode: r.cattleCode, date: r.date, shift: r.shift, volumeLiters: r.volumeLiters, quality: r.quality });

function buildFilter(q) {
  return andFilter(
    { deletedAt: null },
    searchFilter(q.q),
    q.cattleCode && { cattleCode: q.cattleCode },
    q.penId && { penId: { $in: q.penId } },
    q.shift && { shift: { $in: q.shift } },
    dateRangeFilter('date', q.dateFrom, q.dateTo)
  );
}

async function list(q) {
  const res = await paginate(MilkRecord, { filter: buildFilter(q), sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  const pens = await loadPens(res.items);
  return { ...res, items: res.items.map((r) => toItem(r, pens)) };
}

async function getById(id) {
  const r = await MilkRecord.findOne({ _id: id, deletedAt: null }).lean();
  if (!r) throw notFound();
  return { ...toItem(r, await loadPens([r])), amendments: r.amendments || [], canEditFreely: ymdOf(r.createdAt) === todayYmdVN() };
}

// Mỗi bò chỉ được ghi nhận 1 lần / ca / ngày
async function assertNoDuplicate({ cattleId, cattleCode, date, shift, excludeId }) {
  const hit = await MilkRecord.findOne({ cattleId, date, shift, deletedAt: null, ...(excludeId && { _id: { $ne: excludeId } }) }).select('_id');
  if (hit) throw ApiError.conflict(`Bò ${cattleCode} đã có bản ghi ca ${MILK_SHIFT_LABEL[shift]} ngày ${ymdOf(date)}`, 'DUPLICATE_MILK_RECORD');
}

async function create(req, body) {
  const cattle = await findCattleByCode(body.cattleCode);
  assertOperable(cattle); // Đã bán / Đã chết / Đã loại thải
  assertNotQuarantined(cattle); // Đang cách ly
  if (body.date < ymdOf(cattle.joinDate)) throw fieldError('date', 'Ngày ghi nhận không được trước ngày nhập đàn');
  const date = startOfDayVN(body.date);
  await assertNoDuplicate({ cattleId: cattle._id, cattleCode: cattle.code, date, shift: body.shift });

  const r = await MilkRecord.create({
    cattleId: cattle._id, cattleCode: cattle.code, penId: cattle.penId, date, shift: body.shift,
    volumeLiters: body.volumeLiters, quality: body.quality || undefined, createdBy: req.user._id,
  });
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'MilkRecord', entityId: r._id, after: snapshot(r) });
  return toItem(r, await loadPens([r]));
}

async function update(req, id, body) {
  const r = await MilkRecord.findOne({ _id: id, deletedAt: null });
  if (!r) throw notFound();
  if (body.cattleCode !== undefined && body.cattleCode !== r.cattleCode) throw fieldError('cattleCode', 'Không được đổi bò của bản ghi sản lượng', 'CATTLE_IMMUTABLE');

  // Chỉ sửa tự do trong ngày ghi nhận (GMT+7); qua ngày hôm sau cần Quản trị viên xác nhận lại
  let amendment = null;
  if (ymdOf(r.createdAt) !== todayYmdVN()) {
    if (body.confirmAmendment !== true) {
      throw ApiError.conflict('Bản ghi đã qua ngày ghi nhận, cần Quản trị viên xác nhận lại (confirmAmendment = true) kèm lý do (amendReason)', 'AMENDMENT_CONFIRMATION_REQUIRED');
    }
    if (!body.amendReason) throw fieldError('amendReason', 'Bắt buộc nhập lý do điều chỉnh');
    amendment = { at: new Date(), by: req.user._id, reason: body.amendReason };
  }

  const newYmd = body.date ?? ymdOf(r.date);
  const newShift = body.shift ?? r.shift;
  if (body.date !== undefined || body.shift !== undefined) {
    const cattle = await Cattle.findOne({ _id: r.cattleId }).select('joinDate').lean();
    if (cattle && newYmd < ymdOf(cattle.joinDate)) throw fieldError('date', 'Ngày ghi nhận không được trước ngày nhập đàn');
    await assertNoDuplicate({ cattleId: r.cattleId, cattleCode: r.cattleCode, date: startOfDayVN(newYmd), shift: newShift, excludeId: r._id });
  }

  const before = snapshot(r);
  r.date = startOfDayVN(newYmd);
  r.shift = newShift;
  if (body.volumeLiters !== undefined) r.volumeLiters = body.volumeLiters;
  if (body.quality !== undefined) r.quality = body.quality || undefined;
  if (amendment) r.amendments.push(amendment);
  await r.save();

  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'MilkRecord', entityId: id, before, after: snapshot(r), meta: amendment ? { amendReason: amendment.reason } : undefined });
  return toItem(r, await loadPens([r]));
}

// Xóa mềm; chỉ cho xóa bản ghi nhập sai trong 24h
async function remove(req, ids) {
  const deleted = [], failed = [];
  for (const id of ids) {
    const r = await MilkRecord.findOne({ _id: id, deletedAt: null });
    if (!r) { failed.push({ id, code: 'MILK_RECORD_NOT_FOUND', reason: 'Bản ghi không tồn tại hoặc đã bị xóa' }); continue; }
    if (hoursSince(r.createdAt) > PRODUCTION_RULES.MILK_DELETE_WINDOW_HOURS) {
      failed.push({ id, code: 'MILK_DELETE_WINDOW_EXPIRED', reason: `Chỉ được xóa bản ghi nhập sai trong ${PRODUCTION_RULES.MILK_DELETE_WINDOW_HOURS}h kể từ khi tạo` });
      continue;
    }
    const before = snapshot(r);
    r.deletedAt = new Date();
    r.deletedBy = req.user._id;
    await r.save();
    deleted.push({ id, cattleCode: r.cattleCode, mode: 'SOFT' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'MilkRecord', entityId: id, before, after: { mode: 'SOFT' } });
  }
  return { deleted, failed };
}

module.exports = { buildFilter, loadPens, list, getById, create, update, remove, toItem };