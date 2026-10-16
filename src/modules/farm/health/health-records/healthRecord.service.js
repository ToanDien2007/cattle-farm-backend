'use strict';
const ApiError = require('../../../../utils/ApiError');
const AUDIT = require('../../../../constants/auditActions');
const { CATTLE_STATUS } = require('../../../../constants/cattleStatus');
const { CONCLUSION, CONCLUSION_LABEL, HEALTH_RULES } = require('../../../../constants/health');
const HealthRecord = require('./healthRecord.model');
const { assertOperable } = require('../../cattle/cattleStatus.service');
const { fieldError, hoursSince, findCattleByCode, moveCattleStatus } = require('../health.common');
const referenceGuard = require('../../../../shared/referenceGuard');
const audit = require('../../../../shared/audit/auditLog.service');
const { withTransaction } = require('../../../../utils/transaction');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../../../utils/listQuery');
const { startOfDayVN } = require('../../../../utils/datetime');

const MODULE = 'health';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'HEALTH_RECORD_NOT_FOUND');

// Bò đã có hồ sơ khám (kể cả đã xóa mềm - để bảo toàn lịch sử y tế) => không xóa cứng bò
referenceGuard.register('Cattle', 'hồ sơ khám sức khỏe', async (ids) => {
  const rows = await HealthRecord.find({ cattleId: { $in: ids } }).select('cattleId').lean();
  const out = {};
  for (const r of rows) out[String(r.cattleId)] = (out[String(r.cattleId)] || 0) + 1;
  return out;
});

const toItem = (r) => ({
  id: r._id, cattle: { id: r.cattleId, code: r.cattleCode }, examDate: r.examDate,
  symptoms: r.symptoms ?? null, diagnosis: r.diagnosis ?? null, treatment: r.treatment ?? null, medication: r.medication ?? null,
  weightKg: r.weightKg ?? null, performedBy: r.performedBy, conclusion: r.conclusion ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
const snapshot = (r) => ({
  cattleCode: r.cattleCode, examDate: r.examDate, symptoms: r.symptoms, diagnosis: r.diagnosis, treatment: r.treatment,
  medication: r.medication, weightKg: r.weightKg, performedBy: r.performedBy, conclusion: r.conclusion,
});

// since: chặn dưới theo Ngày khám (export tối đa 2 năm)
function buildFilter(q, { since } = {}) {
  return andFilter(
    { deletedAt: null },
    searchFilter(q.q),
    q.cattleCode && { cattleCode: q.cattleCode },
    q.conclusion && { conclusion: { $in: q.conclusion } },
    dateRangeFilter('examDate', q.examFrom, q.examTo),
    since && { examDate: { $gte: since } }
  );
}

async function list(q) {
  const res = await paginate(HealthRecord, { filter: buildFilter(q), sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  return { ...res, items: res.items.map(toItem) };
}

async function getById(id) {
  const r = await HealthRecord.findOne({ _id: id, deletedAt: null }).lean();
  if (!r) throw notFound();
  const others = await HealthRecord.find({ cattleId: r.cattleId, deletedAt: null, _id: { $ne: r._id } }).sort({ examDate: -1, _id: -1 }).lean();
  return {
    ...toItem(r),
    amendments: r.amendments || [],
    canEditFreely: hoursSince(r.createdAt) <= HEALTH_RULES.HEALTH_EDIT_WINDOW_HOURS,
    history: others.map(toItem), // toàn bộ lịch sử khám trước đó của cùng 1 bò
  };
}
// Dùng cho chi tiết bò (module cattle)
async function listByCattle(cattleId, limit = 50) {
  const rows = await HealthRecord.find({ cattleId, deletedAt: null }).sort({ examDate: -1, _id: -1 }).limit(limit).lean();
  return rows.map(toItem);
}

// Kết luận Bệnh => Đang điều trị; Khỏe mạnh => về Đang nuôi. Chỉ áp dụng khi đây là lần khám mới nhất của bò.
async function applyConclusion(r, { actorId, session }) {
  if (!r.conclusion || r.conclusion === CONCLUSION.MONITORING) return null;
  const newer = await HealthRecord.findOne({ cattleId: r.cattleId, deletedAt: null, _id: { $ne: r._id }, examDate: { $gt: r.examDate } }).select('_id').session(session);
  if (newer) return null;
  const sick = r.conclusion === CONCLUSION.SICK;
  return moveCattleStatus(r.cattleId, {
    to: sick ? CATTLE_STATUS.TREATING : CATTLE_STATUS.RAISING,
    allowedFrom: [sick ? CATTLE_STATUS.RAISING : CATTLE_STATUS.TREATING],
    reason: `Kết luận khám: ${CONCLUSION_LABEL[r.conclusion]}`,
    effectiveDate: r.examDate, actorId, session,
  });
}

async function create(req, body) {
  const cattle = await findCattleByCode(body.cattleCode);
  assertOperable(cattle); // Đã bán/Đã chết/Không còn trong đàn => chặn
  const { cattleCode, examDate, ...rest } = body;

  const { record, change } = await withTransaction(async (session) => {
    const [r] = await HealthRecord.create([{ ...rest, cattleId: cattle._id, cattleCode: cattle.code, examDate: startOfDayVN(examDate), createdBy: req.user._id }], { session });
    return { record: r, change: await applyConclusion(r, { actorId: req.user._id, session }) };
  });

  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'HealthRecord', entityId: record._id, after: snapshot(record) });
  if (change) {
    await audit.record(req, { action: AUDIT.STATUS_CHANGE, module: 'cattle', entity: 'Cattle', entityId: cattle._id, before: { status: change.from }, after: { status: change.to, source: 'HEALTH_RECORD', healthRecordId: record._id } });
  }
  return { ...toItem(record), cattleStatus: change ? change.to : cattle.status };
}

async function update(req, id, body) {
  const r = await HealthRecord.findOne({ _id: id, deletedAt: null });
  if (!r) throw notFound();
  if (body.cattleCode !== undefined && body.cattleCode !== r.cattleCode) throw fieldError('cattleCode', 'Không được đổi bò của hồ sơ khám', 'CATTLE_IMMUTABLE');

  if (hoursSince(r.createdAt) > HEALTH_RULES.HEALTH_EDIT_WINDOW_HOURS) {
    if (body.confirmAmendment !== true) {
      throw ApiError.conflict(`Hồ sơ đã quá ${HEALTH_RULES.HEALTH_EDIT_WINDOW_HOURS}h kể từ khi tạo, cần xác nhận bổ sung (confirmAmendment = true) kèm lý do (amendReason)`, 'AMENDMENT_CONFIRMATION_REQUIRED');
    }
    if (!body.amendReason) throw fieldError('amendReason', 'Bắt buộc nhập lý do bổ sung/điều chỉnh');
    r.amendments.push({ at: new Date(), by: req.user._id, reason: body.amendReason });
  }

  const before = snapshot(r);
  const { cattleCode, confirmAmendment, amendReason, examDate, ...rest } = body;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) r[k] = v === '' ? undefined : v;
  if (examDate) r.examDate = startOfDayVN(examDate);
  await r.save();

  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'HealthRecord', entityId: id, before, after: snapshot(r), meta: amendReason ? { amendReason } : undefined });
  return toItem(r);
}

// Xóa mềm (deletedAt): ẩn khỏi danh sách/chi tiết, vẫn còn trong DB và audit log
async function remove(req, ids) {
  const deleted = [], failed = [];
  for (const id of ids) {
    const r = await HealthRecord.findOne({ _id: id, deletedAt: null });
    if (!r) { failed.push({ id, code: 'HEALTH_RECORD_NOT_FOUND', reason: 'Hồ sơ không tồn tại hoặc đã bị xóa' }); continue; }
    const before = snapshot(r);
    r.deletedAt = new Date();
    r.deletedBy = req.user._id;
    await r.save();
    deleted.push({ id, cattleCode: r.cattleCode, mode: 'SOFT' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'HealthRecord', entityId: id, before, after: { mode: 'SOFT' } });
  }
  return { deleted, failed };
}

module.exports = { buildFilter, list, getById, listByCattle, create, update, remove, toItem, snapshot };