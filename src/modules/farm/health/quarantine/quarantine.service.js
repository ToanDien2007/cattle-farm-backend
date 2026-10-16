'use strict';
const ApiError = require('../../../../utils/ApiError');
const AUDIT = require('../../../../constants/auditActions');
const { CATTLE_STATUS, CATTLE_STATUS_LABEL } = require('../../../../constants/cattleStatus');
const { QUARANTINE_STATUS: QS, QUARANTINE_OUTCOME } = require('../../../../constants/health');
const Quarantine = require('./quarantine.model');
const { assertOperable } = require('../../cattle/cattleStatus.service');
const { fieldError, findCattleByCode, moveCattleStatus, daysBetweenYmd } = require('../health.common');
const referenceGuard = require('../../../../shared/referenceGuard');
const audit = require('../../../../shared/audit/auditLog.service');
const { withTransaction } = require('../../../../utils/transaction');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../../../utils/listQuery');
const { startOfDayVN, ymdOf, todayYmdVN } = require('../../../../utils/datetime');

const MODULE = 'health';
const notFound = () => ApiError.notFound('Không tìm thấy đợt cách ly', 'QUARANTINE_NOT_FOUND');

referenceGuard.register('Cattle', 'lịch sử cách ly', async (ids) => {
  const rows = await Quarantine.find({ cattleId: { $in: ids } }).select('cattleId').lean();
  const out = {};
  for (const r of rows) out[String(r.cattleId)] = (out[String(r.cattleId)] || 0) + 1;
  return out;
});

// Module sản lượng (sữa/thịt) gọi hàm này trước khi ghi nhận cho 1 con bò
function assertNotQuarantined(cattle) {
  if (cattle.status === CATTLE_STATUS.QUARANTINED) {
    throw ApiError.conflict(`Bò ${cattle.code} đang cách ly, không thể ghi nhận sản lượng`, 'CATTLE_QUARANTINED');
  }
}

const toItem = (q) => ({
  id: q._id, cattle: { id: q.cattleId, code: q.cattleCode }, disease: q.disease, startDate: q.startDate,
  expectedRecoveryDate: q.expectedRecoveryDate ?? null, status: q.status, endDate: q.endDate ?? null, outcome: q.outcome ?? null,
  daysInQuarantine: daysBetweenYmd(ymdOf(q.startDate), q.endDate ? ymdOf(q.endDate) : todayYmdVN()),
  createdAt: q.createdAt, updatedAt: q.updatedAt,
});
const toDetail = (q) => ({ ...toItem(q), note: q.note ?? null, progress: q.progress || [], endNote: q.endNote ?? null });
const snapshot = (q) => ({ cattleCode: q.cattleCode, disease: q.disease, startDate: q.startDate, expectedRecoveryDate: q.expectedRecoveryDate, status: q.status, endDate: q.endDate, outcome: q.outcome });

async function list(q) {
  const filter = andFilter(
    {},
    searchFilter(q.q),
    q.cattleCode && { cattleCode: q.cattleCode },
    q.status && { status: { $in: q.status } },
    dateRangeFilter('startDate', q.startFrom, q.startTo)
  );
  const res = await paginate(Quarantine, { filter, sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  return { ...res, items: res.items.map(toItem) };
}

async function getById(id) {
  const q = await Quarantine.findOne({ _id: id }).lean();
  if (!q) throw notFound();
  return toDetail(q);
}

// Tiên quyết: bò đang "Đang điều trị". Kết quả: bò -> "Đang cách ly" + ghi lịch sử trạng thái
async function start(req, body) {
  const cattle = await findCattleByCode(body.cattleCode);
  assertOperable(cattle);
  if (cattle.status !== CATTLE_STATUS.TREATING) {
    throw ApiError.conflict(`Chỉ bò đang "${CATTLE_STATUS_LABEL[CATTLE_STATUS.TREATING]}" mới được cách ly (bò ${cattle.code} hiện: ${CATTLE_STATUS_LABEL[cattle.status]})`, 'CATTLE_NOT_TREATING');
  }
  if (body.startDate < ymdOf(cattle.joinDate)) throw fieldError('startDate', 'Ngày cách ly không được trước ngày nhập đàn');

  const q = await withTransaction(async (session) => {
    const change = await moveCattleStatus(cattle._id, {
      to: CATTLE_STATUS.QUARANTINED, allowedFrom: [CATTLE_STATUS.TREATING], reason: `Cách ly: ${body.disease}`,
      effectiveDate: startOfDayVN(body.startDate), actorId: req.user._id, session,
    });
    if (!change) throw ApiError.conflict('Trạng thái bò vừa thay đổi, vui lòng tải lại và thử lại', 'RECORD_CONFLICT');
    const [doc] = await Quarantine.create([{
      cattleId: cattle._id, cattleCode: cattle.code, disease: body.disease, startDate: startOfDayVN(body.startDate),
      expectedRecoveryDate: body.expectedRecoveryDate && startOfDayVN(body.expectedRecoveryDate), note: body.note, startedBy: req.user._id,
    }], { session });
    return doc;
  });

  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'Quarantine', entityId: q._id, after: snapshot(q) });
  await audit.record(req, { action: AUDIT.STATUS_CHANGE, module: 'cattle', entity: 'Cattle', entityId: cattle._id, before: { status: CATTLE_STATUS.TREATING }, after: { status: CATTLE_STATUS.QUARANTINED, source: 'QUARANTINE', quarantineId: q._id } });
  return { ...toDetail(q), cattleStatus: CATTLE_STATUS.QUARANTINED };
}

async function addNote(req, id, body) {
  const q = await Quarantine.findOne({ _id: id });
  if (!q) throw notFound();
  if (q.status !== QS.ACTIVE) throw ApiError.conflict('Đợt cách ly đã kết thúc, không thể thêm diễn biến', 'QUARANTINE_ENDED');
  q.progress.push({ at: new Date(), note: body.note, by: req.user._id });
  await q.save();
  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'Quarantine', entityId: id, meta: { progressNote: body.note } });
  return toDetail(q);
}

// Kết thúc: RECOVERED -> Đang nuôi; CONTINUE_TREATMENT -> Đang điều trị
async function end(req, id, body) {
  const q = await Quarantine.findOne({ _id: id });
  if (!q) throw notFound();
  if (q.status !== QS.ACTIVE) throw ApiError.conflict('Đợt cách ly đã kết thúc trước đó', 'QUARANTINE_ALREADY_ENDED');
  const endYmd = body.endDate || todayYmdVN();
  if (endYmd < ymdOf(q.startDate)) throw fieldError('endDate', 'Ngày kết thúc phải ≥ Ngày cách ly');

  const to = body.outcome === QUARANTINE_OUTCOME.RECOVERED ? CATTLE_STATUS.RAISING : CATTLE_STATUS.TREATING;
  const before = snapshot(q);
  const change = await withTransaction(async (session) => {
    q.status = QS.ENDED;
    q.endDate = startOfDayVN(endYmd);
    q.outcome = body.outcome;
    q.endNote = body.note;
    q.endedBy = req.user._id;
    await q.save({ session });
    return moveCattleStatus(q.cattleId, { to, allowedFrom: [CATTLE_STATUS.QUARANTINED], reason: `Kết thúc cách ly (${body.outcome === QUARANTINE_OUTCOME.RECOVERED ? 'đã khỏi' : 'tiếp tục điều trị'})`, effectiveDate: q.endDate, actorId: req.user._id, session });
  });

  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'Quarantine', entityId: id, before, after: snapshot(q) });
  if (change) await audit.record(req, { action: AUDIT.STATUS_CHANGE, module: 'cattle', entity: 'Cattle', entityId: q.cattleId, before: { status: change.from }, after: { status: change.to, source: 'QUARANTINE', quarantineId: id } });
  return { ...toDetail(q), cattleStatus: change ? change.to : null };
}

module.exports = { list, getById, start, addNote, end, assertNotQuarantined };