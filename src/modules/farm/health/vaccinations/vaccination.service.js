'use strict';
const ApiError = require('../../../../utils/ApiError');
const AUDIT = require('../../../../constants/auditActions');
const {
  VACCINATION_STATUS: ST, HEALTH_RULES, NO_DUE_DATE, VACCINE_CONTRAINDICATIONS,
} = require('../../../../constants/health');
const Vaccination = require('./vaccination.model');
const { assertOperable } = require('../../cattle/cattleStatus.service');
const { fieldError, hoursSince, findCattleByCode, addDaysYmd } = require('../health.common');
const referenceGuard = require('../../../../shared/referenceGuard');
const audit = require('../../../../shared/audit/auditLog.service');
const { withTransaction } = require('../../../../utils/transaction');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../../../utils/listQuery');
const { normalizeForSearch } = require('../../../../utils/vietnamese');
const { startOfDayVN, endOfDayVN, ymdOf, todayYmdVN } = require('../../../../utils/datetime');

const MODULE = 'health';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'VACCINATION_NOT_FOUND');

referenceGuard.register('Cattle', 'lịch sử tiêm phòng', async (ids) => {
  const rows = await Vaccination.find({ cattleId: { $in: ids } }).select('cattleId').lean();
  const out = {};
  for (const r of rows) out[String(r.cattleId)] = (out[String(r.cattleId)] || 0) + 1;
  return out;
});

// Đã tiêm: không có lịch tái tiêm / đã được thay bằng lần tiêm sau; Quá hạn: ngày tái tiêm < hôm nay; Sắp đến hạn: trong 7 ngày tới
function statusOf(v, today = todayYmdVN()) {
  if (v.renewedBy || !v.nextDueDate) return ST.DONE;
  const due = ymdOf(v.nextDueDate);
  if (due < today) return ST.OVERDUE;
  return due <= addDaysYmd(today, HEALTH_RULES.DUE_SOON_DAYS) ? ST.DUE_SOON : ST.DONE;
}

const toItem = (v, today) => ({
  id: v._id, cattle: { id: v.cattleId, code: v.cattleCode }, vaccineType: v.vaccineType, vaccinationDate: v.vaccinationDate,
  dose: v.dose, nextDueDate: v.nextDueDate ?? null, performedBy: v.performedBy, status: statusOf(v, today),
  createdAt: v.createdAt, updatedAt: v.updatedAt,
});
const snapshot = (v) => ({ cattleCode: v.cattleCode, vaccineType: v.vaccineType, vaccinationDate: v.vaccinationDate, dose: v.dose, nextDueDate: v.nextDueDate, performedBy: v.performedBy });

// Điều kiện DB tương ứng statusOf (dựa trên dueSort)
function statusFilter(statuses) {
  if (!statuses?.length) return null;
  const today = todayYmdVN();
  const start = startOfDayVN(today), soonEnd = endOfDayVN(addDaysYmd(today, HEALTH_RULES.DUE_SOON_DAYS));
  const cond = {
    [ST.OVERDUE]: { dueSort: { $lt: start } },
    [ST.DUE_SOON]: { dueSort: { $gte: start, $lte: soonEnd } },
    [ST.DONE]: { dueSort: { $gt: soonEnd } },
  };
  return statuses.length === 1 ? cond[statuses[0]] : { $or: statuses.map((s) => cond[s]) };
}

function buildFilter(q) {
  return andFilter(
    { deletedAt: null },
    searchFilter(q.q),
    q.cattleCode && { cattleCode: q.cattleCode },
    q.vaccineType && { vaccineKey: { $in: q.vaccineType.map(normalizeForSearch) } },
    statusFilter(q.status),
    dateRangeFilter('vaccinationDate', q.dateFrom, q.dateTo)
  );
}

async function list(q) {
  const sortField = q.sortBy === 'nextDueDate' ? 'dueSort' : q.sortBy;
  const res = await paginate(Vaccination, { filter: buildFilter(q), sort: buildSort(sortField, q.order), page: q.page, limit: q.limit });
  const today = todayYmdVN();
  return { ...res, items: res.items.map((v) => toItem(v, today)) };
}
+// Dùng cho chi tiết bò (module cattle)
async function listByCattle(cattleId, limit = 50) {
  const rows = await Vaccination.find({ cattleId, deletedAt: null }).sort({ vaccinationDate: -1, _id: -1 }).limit(limit).lean();
  const today = todayYmdVN();
  return rows.map((v) => toItem(v, today));
}

// Nối lại chuỗi các lần tiêm cùng loại của 1 bò: lần tiêm sau (ngày lớn hơn) thay thế lịch tái tiêm của lần trước
async function relink(cattleId, vaccineKey, session) {
  const rows = await Vaccination.find({ cattleId, vaccineKey, deletedAt: null }).sort({ vaccinationDate: 1, _id: 1 }).session(session);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const next = rows.slice(i + 1).find((x) => x.vaccinationDate > r.vaccinationDate);
    const dueSort = !next && r.nextDueDate ? r.nextDueDate : NO_DUE_DATE;
    const sameLink = String(r.renewedBy || '') === String(next?._id || '');
    if (sameLink && +r.dueSort === +dueSort) continue;
    await Vaccination.updateOne({ _id: r._id }, next ? { $set: { renewedBy: next._id, dueSort } } : { $set: { dueSort }, $unset: { renewedBy: 1 } }, { session });
  }
}

// Không tiêm 2 loại chống chỉ định với nhau trong cùng ngày cho cùng 1 bò
async function assertNoContraindication({ cattleId, cattleCode, vaccineType, vaccineKey, date, excludeId }) {
  const conflictKeys = VACCINE_CONTRAINDICATIONS
    .map(([a, b]) => [normalizeForSearch(a), normalizeForSearch(b)])
    .flatMap(([a, b]) => (a === vaccineKey ? [b] : b === vaccineKey ? [a] : []));
  if (!conflictKeys.length) return;
  const hit = await Vaccination.findOne({ cattleId, deletedAt: null, vaccinationDate: date, vaccineKey: { $in: conflictKeys }, ...(excludeId && { _id: { $ne: excludeId } }) });
  if (hit) {
    throw ApiError.conflict(`Bò ${cattleCode} đã tiêm "${hit.vaccineType}" ngày ${ymdOf(date)}, chống chỉ định tiêm cùng ngày với "${vaccineType}"`, 'VACCINE_CONTRAINDICATED');
  }
}

async function create(req, body) {
  const cattle = await findCattleByCode(body.cattleCode);
  assertOperable(cattle);
  const date = startOfDayVN(body.vaccinationDate);
  const vaccineKey = normalizeForSearch(body.vaccineType);
  await assertNoContraindication({ cattleId: cattle._id, cattleCode: cattle.code, vaccineType: body.vaccineType, vaccineKey, date });

  const nextYmd = body.intervalDays ? addDaysYmd(body.vaccinationDate, body.intervalDays) : body.nextDueDate || null;
  const v = await withTransaction(async (session) => {
    const [doc] = await Vaccination.create([{
      cattleId: cattle._id, cattleCode: cattle.code, vaccineType: body.vaccineType, vaccinationDate: date, dose: body.dose,
      nextDueDate: nextYmd ? startOfDayVN(nextYmd) : undefined, performedBy: body.performedBy, createdBy: req.user._id,
    }], { session });
    await relink(cattle._id, doc.vaccineKey, session);
    return doc;
  });
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'Vaccination', entityId: v._id, after: snapshot(v) });
  const fresh = await Vaccination.findOne({ _id: v._id }).lean();
  return toItem(fresh);
}

async function update(req, id, body) {
  const v = await Vaccination.findOne({ _id: id, deletedAt: null });
  if (!v) throw notFound();
  if (body.cattleCode !== undefined && body.cattleCode !== v.cattleCode) throw fieldError('cattleCode', 'Không được đổi bò của bản ghi tiêm phòng', 'CATTLE_IMMUTABLE');

  const curYmd = ymdOf(v.vaccinationDate);
  const newYmd = body.vaccinationDate ?? curYmd;
  if (newYmd !== curYmd && hoursSince(v.createdAt) > HEALTH_RULES.VACCINATION_DATE_EDIT_WINDOW_HOURS) {
    throw ApiError.conflict(`Không được sửa Ngày tiêm sau ${HEALTH_RULES.VACCINATION_DATE_EDIT_WINDOW_HOURS}h kể từ khi ghi nhận`, 'VACCINATION_DATE_LOCKED');
  }
  let nextYmd = v.nextDueDate ? ymdOf(v.nextDueDate) : null;
  if (body.intervalDays) nextYmd = addDaysYmd(newYmd, body.intervalDays);
  else if (body.nextDueDate !== undefined) nextYmd = body.nextDueDate; // null = bỏ lịch tái tiêm
  if (nextYmd && nextYmd < newYmd) throw fieldError('nextDueDate', 'Ngày tái tiêm phải ≥ Ngày tiêm');

  const oldKey = v.vaccineKey;
  const newType = body.vaccineType ?? v.vaccineType;
  const newKey = normalizeForSearch(newType);
  if (newKey !== oldKey || newYmd !== curYmd) {
    await assertNoContraindication({ cattleId: v.cattleId, cattleCode: v.cattleCode, vaccineType: newType, vaccineKey: newKey, date: startOfDayVN(newYmd), excludeId: v._id });
  }

  const before = snapshot(v);
  v.vaccineType = newType;
  v.vaccinationDate = startOfDayVN(newYmd);
  if (body.dose !== undefined) v.dose = body.dose;
  if (body.performedBy !== undefined) v.performedBy = body.performedBy;
  v.nextDueDate = nextYmd ? startOfDayVN(nextYmd) : undefined;
  await withTransaction(async (session) => {
    await v.save({ session });
    await relink(v.cattleId, v.vaccineKey, session);
    if (oldKey !== v.vaccineKey) await relink(v.cattleId, oldKey, session);
  });

  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'Vaccination', entityId: id, before, after: snapshot(v) });
  return toItem(await Vaccination.findOne({ _id: id }).lean());
}

// Xóa mềm; chỉ cho xóa bản ghi tạo nhầm trong 24h
async function remove(req, ids) {
  const deleted = [], failed = [];
  for (const id of ids) {
    const v = await Vaccination.findOne({ _id: id, deletedAt: null });
    if (!v) { failed.push({ id, code: 'VACCINATION_NOT_FOUND', reason: 'Bản ghi không tồn tại hoặc đã bị xóa' }); continue; }
    if (hoursSince(v.createdAt) > HEALTH_RULES.VACCINATION_DELETE_WINDOW_HOURS) {
      failed.push({ id, code: 'VACCINATION_DELETE_WINDOW_EXPIRED', reason: `Chỉ được xóa bản ghi tạo nhầm trong ${HEALTH_RULES.VACCINATION_DELETE_WINDOW_HOURS}h; hãy thêm bản ghi điều chỉnh` });
      continue;
    }
    const before = snapshot(v);
    await withTransaction(async (session) => {
      v.deletedAt = new Date();
      v.deletedBy = req.user._id;
      await v.save({ session });
      await relink(v.cattleId, v.vaccineKey, session);
    });
    deleted.push({ id, cattleCode: v.cattleCode, mode: 'SOFT' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'Vaccination', entityId: id, before, after: { mode: 'SOFT' } });
  }
  return { deleted, failed };
}

module.exports = { buildFilter, list, listByCattle, create, update, remove, toItem, statusOf };