'use strict';
const ApiError = require('../../../../utils/ApiError');
const AUDIT = require('../../../../constants/auditActions');
const { CATTLE_STATUS, CATTLE_STATUS_LABEL } = require('../../../../constants/cattleStatus');
const { MEAT_STATUS } = require('../../../../constants/production');
const MeatRecord = require('./meatRecord.model');
const { findCattleByCode, fieldError } = require('../../health/health.common');
const referenceGuard = require('../../../../shared/referenceGuard');
const audit = require('../../../../shared/audit/auditLog.service');
const { paginate, searchFilter, dateRangeFilter, buildSort, andFilter } = require('../../../../utils/listQuery');
const { startOfDayVN } = require('../../../../utils/datetime');

const MODULE = 'production';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'MEAT_RECORD_NOT_FOUND');
const locked = (msg) => ApiError.conflict(msg, 'MEAT_RECORD_LOCKED');

referenceGuard.register('Cattle', 'bản ghi sản lượng thịt', async (ids) => {
  const rows = await MeatRecord.find({ cattleId: { $in: ids } }).select('cattleId').lean();
  const out = {};
  for (const r of rows) out[String(r.cattleId)] = (out[String(r.cattleId)] || 0) + 1;
  return out;
});

const toItem = (r) => ({
  id: r._id, cattle: { id: r.cattleId, code: r.cattleCode }, weightKg: r.weightKg, exportDate: r.exportDate,
  productType: r.productType ?? null, batchCode: r.batchCode, status: r.status, transferredAt: r.transferredAt ?? null,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
});
const snapshot = (r) => ({ cattleCode: r.cattleCode, weightKg: r.weightKg, exportDate: r.exportDate, productType: r.productType, batchCode: r.batchCode });

function buildFilter(q) {
  return andFilter(
    { deletedAt: null },
    searchFilter(q.q),
    q.cattleCode && { cattleCode: q.cattleCode },
    q.batchCode && { batchCode: q.batchCode },
    q.productType && { productType: { $in: q.productType } },
    dateRangeFilter('exportDate', q.dateFrom, q.dateTo)
  );
}

async function list(q) {
  const res = await paginate(MeatRecord, { filter: buildFilter(q), sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  return { ...res, items: res.items.map(toItem) };
}

async function getById(id) {
  const r = await MeatRecord.findOne({ _id: id, deletedAt: null }).lean();
  if (!r) throw notFound();
  return toItem(r);
}

// Dùng cho chi tiết bò (module cattle)
async function listByCattle(cattleId, limit = 50) {
  const rows = await MeatRecord.find({ cattleId, deletedAt: null }).sort({ exportDate: -1, _id: -1 }).limit(limit).lean();
  return rows.map(toItem);
}

// Lô đã xuất sang Kho sản phẩm đầu ra thì không thêm/chuyển bản ghi vào lô đó nữa
async function assertBatchOpen(batchCode) {
  const hit = await MeatRecord.findOne({ batchCode, status: MEAT_STATUS.TRANSFERRED, deletedAt: null }).select('_id');
  if (hit) throw ApiError.conflict(`Lô ${batchCode} đã xuất sang Kho sản phẩm đầu ra, không thể thêm bản ghi vào lô này`, 'BATCH_TRANSFERRED');
}

// Module output-products gọi khi xuất 1 lô sang Kho: khóa toàn bộ bản ghi nháp của lô
async function markBatchTransferred(batchCode, { outputProductId, session } = {}) {
  await MeatRecord.updateMany(
    { batchCode: String(batchCode).trim().toUpperCase(), deletedAt: null, status: MEAT_STATUS.DRAFT },
    { $set: { status: MEAT_STATUS.TRANSFERRED, transferredAt: new Date(), ...(outputProductId && { outputProductId }) } },
    { session }
  );
}

async function create(req, body) {
  const cattle = await findCattleByCode(body.cattleCode);
  // Spec thịt: chỉ ghi nhận cho bò Đã bán (chuyển mục đích xuất thịt) - khác sản lượng sữa (không cho bò Đã bán)
  if (cattle.status !== CATTLE_STATUS.SOLD) {
    throw ApiError.conflict(`Chỉ ghi nhận sản lượng thịt cho bò ở trạng thái "${CATTLE_STATUS_LABEL[CATTLE_STATUS.SOLD]}" (bò ${cattle.code} hiện: ${CATTLE_STATUS_LABEL[cattle.status]})`, 'CATTLE_NOT_SOLD');
  }
  await assertBatchOpen(body.batchCode);

  const r = await MeatRecord.create({
    cattleId: cattle._id, cattleCode: cattle.code, weightKg: body.weightKg, exportDate: startOfDayVN(body.exportDate),
    productType: body.productType, batchCode: body.batchCode, createdBy: req.user._id,
  });
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'MeatRecord', entityId: r._id, after: snapshot(r) });
  return toItem(r);
}

async function update(req, id, body) {
  const r = await MeatRecord.findOne({ _id: id, deletedAt: null });
  if (!r) throw notFound();
  if (r.status === MEAT_STATUS.TRANSFERRED) throw locked('Lô sản xuất đã xuất sang Kho sản phẩm đầu ra, không được sửa');
  if (body.cattleCode !== undefined && body.cattleCode !== r.cattleCode) throw fieldError('cattleCode', 'Không được đổi bò của bản ghi sản lượng thịt', 'CATTLE_IMMUTABLE');
  if (body.batchCode !== undefined && body.batchCode !== r.batchCode) await assertBatchOpen(body.batchCode);

  const before = snapshot(r);
  if (body.weightKg !== undefined) r.weightKg = body.weightKg;
  if (body.exportDate !== undefined) r.exportDate = startOfDayVN(body.exportDate);
  if (body.productType !== undefined) r.productType = body.productType ?? undefined;
  if (body.batchCode !== undefined) r.batchCode = body.batchCode;
  await r.save();

  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'MeatRecord', entityId: id, before, after: snapshot(r) });
  return toItem(r);
}

// Xóa mềm; chỉ xóa được bản ghi nháp chưa xuất kho
async function remove(req, ids) {
  const deleted = [], failed = [];
  for (const id of ids) {
    const r = await MeatRecord.findOne({ _id: id, deletedAt: null });
    if (!r) { failed.push({ id, code: 'MEAT_RECORD_NOT_FOUND', reason: 'Bản ghi không tồn tại hoặc đã bị xóa' }); continue; }
    if (r.status === MEAT_STATUS.TRANSFERRED) {
      failed.push({ id, code: 'MEAT_RECORD_LOCKED', reason: `Lô ${r.batchCode} đã xuất sang Kho sản phẩm đầu ra, không được xóa` });
      continue;
    }
    const before = snapshot(r);
    r.deletedAt = new Date();
    r.deletedBy = req.user._id;
    await r.save();
    deleted.push({ id, cattleCode: r.cattleCode, mode: 'SOFT' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'MeatRecord', entityId: id, before, after: { mode: 'SOFT' } });
  }
  return { deleted, failed };
}

module.exports = { buildFilter, list, getById, listByCattle, markBatchTransferred, create, update, remove, toItem };