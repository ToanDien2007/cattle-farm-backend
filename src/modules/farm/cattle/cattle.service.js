'use strict';
const ApiError = require('../../../utils/ApiError');
const AUDIT = require('../../../constants/auditActions');
const { CATTLE_STATUS, CATTLE_STATUS_LABEL, IN_HERD } = require('../../../constants/cattleStatus');
const { BREED_STATUS } = require('../../../constants/farm');
const Cattle = require('./cattle.model');
const CattleStatusHistory = require('./cattleStatusHistory.model');
const Breed = require('../breeds/breed.model');
const Pen = require('../pens/pen.model');
const PenAssignment = require('../pens/penAssignment.model');
const AuditLog = require('../../../shared/audit/auditLog.model');
const { checkPenCapacity, recordAssignment, moveCattle } = require('../pens/penAssignment.service');
const healthRecordService = require('../health/health-records/healthRecord.service');
const vaccinationService = require('../health/vaccinations/vaccination.service');
const referenceGuard = require('../../../shared/referenceGuard');
const audit = require('../../../shared/audit/auditLog.service');
const { withTransaction } = require('../../../utils/transaction');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../../utils/listQuery');
const { startOfDayVN, ymdOf, todayYmdVN, shiftMonthsVN, ageInMonthsVN } = require('../../../utils/datetime');

const MODULE = 'cattle';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'CATTLE_NOT_FOUND');
const fieldError = (field, message, code = 'VALIDATION_ERROR') => ApiError.unprocessable('Dữ liệu không hợp lệ', [{ field: `body.${field}`, message }], code);

// Bò con (phả hệ) cũng là dữ liệu liên quan: không xóa cứng bò đang là bố/mẹ của bò khác
referenceGuard.register('Cattle', 'bò con (phả hệ)', async (ids) => {
  const rows = await Cattle.find({ $or: [{ sireId: { $in: ids } }, { damId: { $in: ids } }] }).select('sireId damId').lean();
  const out = {};
  for (const r of rows) for (const p of [r.sireId, r.damId]) if (p && ids.includes(String(p))) out[String(p)] = (out[String(p)] || 0) + 1;
  return out;
});

// ---- hiển thị ----
async function loadRefs(docs) {
  const uniq = (xs) => [...new Set(xs.filter(Boolean).map(String))];
  const [breeds, pens] = await Promise.all([
    Breed.find({ _id: { $in: uniq(docs.map((d) => d.breedId)) } }).lean(),
    Pen.find({ _id: { $in: uniq(docs.map((d) => d.penId)) } }).lean(),
  ]);
  return { breeds: new Map(breeds.map((b) => [String(b._id), b])), pens: new Map(pens.map((p) => [String(p._id), p])) };
}

const toItem = (c, refs) => {
  const b = refs.breeds.get(String(c.breedId)), p = refs.pens.get(String(c.penId));
  return {
    id: c._id, code: c.code, earTag: c.earTag, name: c.name ?? null, image: c.image ?? null,
    breed: b ? { id: b._id, name: b.name } : null,
    pen: p ? { id: p._id, code: p.code, name: p.name } : null,
    status: c.status, sex: c.sex, weightKg: c.weightKg, birthDate: c.birthDate,
    ageMonths: ageInMonthsVN(c.birthDate), origin: c.origin ?? null, joinDate: c.joinDate, note: c.note ?? null,
  };
};

// Dữ liệu trước/sau để ghi audit
const snapshot = (c) => ({
  code: c.code, earTag: c.earTag, name: c.name, breedId: c.breedId, sex: c.sex, birthDate: c.birthDate, weightKg: c.weightKg,
  penId: c.penId, origin: c.origin, joinDate: c.joinDate, image: c.image, note: c.note, status: c.status,
});

// ---- bộ lọc ----
function buildFilter(q) {
  const today = todayYmdVN();
  const age = {};
  if (q.ageMonthsMin != null) age.$lte = shiftMonthsVN(today, -q.ageMonthsMin); // đã đủ ít nhất N tháng
  if (q.ageMonthsMax != null) age.$gt = shiftMonthsVN(today, -(q.ageMonthsMax + 1)); // chưa đủ (M+1) tháng
  const weight = {};
  if (q.weightMin != null) weight.$gte = q.weightMin;
  if (q.weightMax != null) weight.$lte = q.weightMax;
  return andFilter(
    {},
    searchFilter(q.q),
    q.breedId && { breedId: { $in: q.breedId } },
    q.penId && { penId: { $in: q.penId } },
    q.sex && { sex: { $in: q.sex } },
    q.status && { status: { $in: q.status } },
    Object.keys(age).length && { birthDate: age },
    Object.keys(weight).length && { weightKg: weight },
    dateRangeFilter('joinDate', q.joinedFrom, q.joinedTo)
  );
}

async function list(q) {
  const res = await paginate(Cattle, { filter: buildFilter(q), sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  const refs = await loadRefs(res.items);
  return { ...res, items: res.items.map((c) => toItem(c, refs)) };
}

async function getById(id) {
  const c = await Cattle.findOne({ _id: id }).lean();
  if (!c) throw notFound();
  const refs = await loadRefs([c]);

  const parentIds = [c.sireId, c.damId].filter(Boolean);
  const [parents, moves, statuses, history, healthRecords, vaccinations] = await Promise.all([
    Cattle.find({ _id: { $in: parentIds } }).lean(),
    PenAssignment.find({ cattleId: c._id }).sort({ movedAt: -1 }).limit(50).lean(),
    CattleStatusHistory.find({ cattleId: c._id }).sort({ createdAt: -1 }).limit(50).lean(),
    AuditLog.find({ module: MODULE, entity: 'Cattle', entityId: String(c._id) }).sort({ createdAt: -1 }).limit(50).lean(),
    healthRecordService.listByCattle(c._id),
    vaccinationService.listByCattle(c._id),
  ]);
  const par = (pid) => {
    const p = parents.find((x) => String(x._id) === String(pid));
    return p ? { id: p._id, code: p.code, name: p.name, sex: p.sex, status: p.status } : null;
  };
  const penRefs = await loadRefs(moves.flatMap((m) => [{ penId: m.fromPenId }, { penId: m.toPenId }]));
  const penName = (pid) => (pid ? penRefs.pens.get(String(pid))?.code ?? null : null);

  return {
    ...toItem(c, refs),
    pedigree: { sire: par(c.sireId), dam: par(c.damId) },
    penHistory: moves.map((m) => ({ movedAt: m.movedAt, from: penName(m.fromPenId), to: penName(m.toPenId), movedBy: m.movedBy, note: m.note })),
    statusHistory: statuses,
    history: history.map((h) => ({ at: h.createdAt, action: h.action, actorId: h.actorId, before: h.before, after: h.after })), // lịch sử thay đổi
    healthRecords, vaccinations,
    // TODO: nạp khi có module farm/production (sản lượng)
    production: [],
  };
}

// ---- tạo ----
async function assertBreedSelectable(breedId) {
  const b = await Breed.findOne({ _id: breedId, status: BREED_STATUS.ACTIVE });
  if (!b) throw fieldError('breedId', 'Giống bò không tồn tại hoặc đã bị ẩn', 'BREED_NOT_FOUND');
}

async function assertUnique({ code, earTag }, excludeId) {
  const conds = [];
  if (code) conds.push({ code });
  if (earTag) conds.push({ earTag });
  const dup = await Cattle.findOne({ $or: conds, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  if (!dup) return;
  if (code && dup.code === code) throw ApiError.conflict('Mã bò đã tồn tại', 'CATTLE_CODE_TAKEN', [{ field: 'code' }]);
  throw ApiError.conflict('Số tai/RFID đã tồn tại', 'EAR_TAG_TAKEN', [{ field: 'earTag' }]);
}

const toDoc = (b) => ({
  code: b.code, earTag: b.earTag, name: b.name || undefined, breedId: b.breedId, sex: b.sex,
  birthDate: startOfDayVN(b.birthDate), weightKg: b.weightKg, penId: b.penId, origin: b.origin,
  joinDate: startOfDayVN(b.joinDate), image: b.image || undefined, note: b.note || undefined,
});

// Tạo bò + ghi lịch sử nhập chuồng (trong transaction). extra: số bò đã xếp vào chuồng đó trong cùng đợt import.
async function insertCattle(body, { actorId, session, extra = 0 }) {
  const { pen, warning } = await checkPenCapacity(body.penId, { session, extra });
  const [c] = await Cattle.create([toDoc(body)], { session });
  await recordAssignment({ cattleId: c._id, fromPenId: null, toPenId: pen._id, movedBy: actorId, note: 'Nhập đàn' }, session);
  return { cattle: c, warning };
}

async function create(req, body) {
  await assertUnique(body);
  await assertBreedSelectable(body.breedId);
  const { cattle, warning } = await withTransaction((session) => insertCattle(body, { actorId: req.user._id, session }));
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'Cattle', entityId: cattle._id, after: snapshot(cattle) });
  const item = toItem(cattle, await loadRefs([cattle]));
  return { ...item, warnings: warning ? [warning] : [] };
}

// ---- sửa ----
async function update(req, id, body) {
  const c = await Cattle.findOne({ _id: id });
  if (!c) throw notFound();
  if (c.status === CATTLE_STATUS.REMOVED) throw ApiError.conflict('Bò đã không còn trong đàn, không thể sửa', 'RECORD_CONFLICT');
  if (body.code !== undefined && body.code.toUpperCase() !== c.code) throw fieldError('code', 'Không được sửa Mã bò sau khi tạo', 'CODE_IMMUTABLE');

  const birthYmd = body.birthDate ?? ymdOf(c.birthDate);
  const joinYmd = body.joinDate ?? ymdOf(c.joinDate);
  if (joinYmd < birthYmd) throw fieldError('joinDate', 'Ngày nhập đàn phải ≥ Ngày sinh');

  if (body.earTag && body.earTag !== c.earTag) await assertUnique({ earTag: body.earTag }, id);
  if (body.breedId && String(body.breedId) !== String(c.breedId)) await assertBreedSelectable(body.breedId);

  const before = snapshot(c);
  const { code, birthDate, joinDate, penId, ...rest } = body;
  for (const [k, v] of Object.entries(rest)) c[k] = v === '' ? undefined : v;
  if (birthDate) c.birthDate = startOfDayVN(birthDate);
  if (joinDate) c.joinDate = startOfDayVN(joinDate);

  const moving = penId && String(penId) !== String(c.penId);
  const warning = await withTransaction(async (session) => {
    if (moving) return (await moveCattle(c, penId, { movedBy: req.user._id, note: 'Chỉnh sửa hồ sơ', session })).warning;
    await c.save({ session });
    return null;
  });

  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'Cattle', entityId: id, before, after: snapshot(c) });
  return { ...toItem(c, await loadRefs([c])), warnings: warning ? [warning] : [] };
}

async function movePen(req, id, { penId, note }) {
  const c = await Cattle.findOne({ _id: id });
  if (!c) throw notFound();
  const fromPenId = c.penId;
  const { pen, warning } = await withTransaction((session) => moveCattle(c, penId, { movedBy: req.user._id, note, session }));
  await audit.record(req, { action: AUDIT.MOVE, module: MODULE, entity: 'Cattle', entityId: id, before: { penId: fromPenId }, after: { penId: pen._id }, meta: { note } });
  return { ...toItem(c, await loadRefs([c])), warnings: warning ? [warning] : [] };
}

// ---- xóa ----
// Chưa có dữ liệu liên quan => xóa cứng (nhập nhầm). Đã có (sức khỏe, sản lượng, bò con...) => chỉ chuyển "Không còn trong đàn".
async function remove(req, ids) {
  const docs = await Cattle.find({ _id: { $in: ids } });
  const byId = new Map(docs.map((c) => [String(c._id), c]));
  const refs = await referenceGuard.referencesOf('Cattle', docs.map((c) => String(c._id)));
  const deleted = [], failed = [];

  for (const id of ids) {
    const c = byId.get(id);
    if (!c) { failed.push({ id, code: 'CATTLE_NOT_FOUND', reason: 'Bò không tồn tại' }); continue; }
    const before = snapshot(c);

    if (!refs[id]) {
      await withTransaction(async (session) => {
        await Cattle.deleteOne({ _id: c._id }, { session });
        await PenAssignment.deleteMany({ cattleId: c._id }, { session });
        await CattleStatusHistory.deleteMany({ cattleId: c._id }, { session });
      });
      deleted.push({ id, code: c.code, mode: 'HARD' });
      await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'Cattle', entityId: id, before, after: { mode: 'HARD' } });
      continue;
    }

    const why = referenceGuard.describe(refs[id]);
    if (!IN_HERD.includes(c.status)) {
      failed.push({ id, code: 'CATTLE_HAS_DATA', reason: `Bò ${c.code} có dữ liệu liên quan (${why}) và đang ở trạng thái "${CATTLE_STATUS_LABEL[c.status]}", không thể xóa` });
      continue;
    }
    const now = new Date();
    await withTransaction(async (session) => {
      const from = c.status;
      c.status = CATTLE_STATUS.REMOVED;
      c.statusChangedAt = now;
      c.exit = { date: now, reason: `Xóa khỏi danh sách (có dữ liệu liên quan: ${why})` };
      await c.save({ session });
      await CattleStatusHistory.create([{ cattleId: c._id, from, to: CATTLE_STATUS.REMOVED, effectiveDate: now, reason: c.exit.reason, changedBy: req.user._id }], { session });
    });
    deleted.push({ id, code: c.code, mode: 'SOFT' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'Cattle', entityId: id, before, after: { mode: 'SOFT', status: c.status } });
  }
  return { deleted, failed };
}

module.exports = { buildFilter, list, getById, create, insertCattle, assertBreedSelectable, update, movePen, remove, loadRefs, toItem, snapshot };
