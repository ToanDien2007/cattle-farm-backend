'use strict';
const ApiError = require('../../../utils/ApiError');
const AUDIT = require('../../../constants/auditActions');
const { SEX } = require('../../../constants/cattleStatus');
const Cattle = require('./cattle.model');
const audit = require('../../../shared/audit/auditLog.service');

const summary = (c) => (c ? { id: c._id, code: c.code, name: c.name, sex: c.sex, status: c.status } : null);
const fieldError = (field, message, code = 'VALIDATION_ERROR') => ApiError.unprocessable('Dữ liệu không hợp lệ', [{ field: `body.${field}`, message }], code);

// Tổ tiên của các bò trong startIds, tối đa `gens` đời (có chống vòng lặp). Trả Set id (không gồm startIds).
async function ancestors(startIds, gens) {
  const seen = new Set();
  const start = new Set(startIds.map(String));
  let level = [...start];
  for (let g = 0; g < gens && level.length; g++) {
    const docs = await Cattle.find({ _id: { $in: level } }).select('sireId damId').lean();
    const next = [];
    for (const d of docs) {
      for (const p of [d.sireId, d.damId]) {
        if (p && !seen.has(String(p)) && !start.has(String(p))) { seen.add(String(p)); next.push(String(p)); }
      }
    }
    level = next;
  }
  return seen;
}

// Ghi nhận Bố/Mẹ theo mã bò. Chặn: mã không tồn tại, tự làm bố/mẹ của chính mình, vòng lặp phả hệ.
// Cảnh báo (không chặn): nguy cơ cận huyết khi Bố và Mẹ có chung tổ tiên trong 3 đời.
async function setPedigree(req, id, body) {
  const c = await Cattle.findOne({ _id: id });
  if (!c) throw ApiError.notFound('Không tìm thấy dữ liệu', 'CATTLE_NOT_FOUND');

  const resolve = async (field, code, sex, label) => {
    if (code === undefined) return { keep: true };
    if (code === null || code === '') return { id: null, doc: null };
    const doc = await Cattle.findOne({ code: code.toUpperCase() });
    if (!doc) throw fieldError(field, `Mã ${label} không tồn tại trong hệ thống`, 'PARENT_NOT_FOUND');
    if (String(doc._id) === String(c._id)) throw fieldError(field, `Không thể chọn chính cá thể này làm ${label}`, 'PEDIGREE_SELF');
    if (doc.sex !== sex) throw fieldError(field, `${label[0].toUpperCase()}${label.slice(1)} phải là bò ${sex === SEX.MALE ? 'đực' : 'cái'}`, 'PARENT_SEX_MISMATCH');
    return { id: doc._id, doc };
  };

  const sire = await resolve('sireCode', body.sireCode, SEX.MALE, 'bố');
  const dam = await resolve('damCode', body.damCode, SEX.FEMALE, 'mẹ');
  const sireId = sire.keep ? c.sireId : sire.id;
  const damId = dam.keep ? c.damId : dam.id;

  // Vòng lặp: nếu chính c là tổ tiên của bố/mẹ được chọn thì c đang là hậu duệ của chính mình
  for (const [field, pid] of [['sireCode', sireId], ['damCode', damId]]) {
    if (!pid) continue;
    if ((await ancestors([pid], 25)).has(String(c._id))) throw fieldError(field, 'Tạo vòng lặp phả hệ: cá thể này là tổ tiên của bố/mẹ được chọn', 'PEDIGREE_LOOP');
  }

  const warnings = [];
  if (sireId && damId) {
    const a = await ancestors([sireId], 3), b = await ancestors([damId], 3);
    a.add(String(sireId)); b.add(String(damId));
    const common = [...a].filter((x) => b.has(x));
    if (common.length) {
      const docs = await Cattle.find({ _id: { $in: common } }).select('code').lean();
      warnings.push({ code: 'INBREEDING_RISK', message: `Nguy cơ cận huyết: bố và mẹ có chung huyết thống (${docs.map((d) => d.code).join(', ')})` });
    }
  }

  const before = { sireId: c.sireId, damId: c.damId };
  c.sireId = sireId || undefined;
  c.damId = damId || undefined;
  await c.save();
  await audit.record(req, { action: AUDIT.PEDIGREE, module: 'cattle', entity: 'Cattle', entityId: id, before, after: { sireId, damId } });

  const parents = await Cattle.find({ _id: { $in: [sireId, damId].filter(Boolean) } }).lean();
  const byId = new Map(parents.map((p) => [String(p._id), p]));
  return { id: c._id, code: c.code, sire: summary(byId.get(String(sireId))), dam: summary(byId.get(String(damId))), warnings };
}

// Cây phả hệ tổ tiên `depth` đời + danh sách con trực tiếp
async function getTree(id, depth = 3) {
  const root = await Cattle.findOne({ _id: id }).lean();
  if (!root) throw ApiError.notFound('Không tìm thấy dữ liệu', 'CATTLE_NOT_FOUND');

  const docs = new Map([[String(root._id), root]]);
  let level = [root];
  for (let g = 0; g < depth; g++) {
    const ids = level.flatMap((d) => [d.sireId, d.damId]).filter((x) => x && !docs.has(String(x)));
    if (!ids.length) break;
    const found = await Cattle.find({ _id: { $in: ids } }).lean();
    found.forEach((d) => docs.set(String(d._id), d));
    level = found;
  }
  const build = (doc, left) =>
    !doc ? null : { ...summary(doc), sire: left > 0 ? build(docs.get(String(doc.sireId)), left - 1) : null, dam: left > 0 ? build(docs.get(String(doc.damId)), left - 1) : null };

  const children = await Cattle.find({ $or: [{ sireId: root._id }, { damId: root._id }] }).sort({ birthDate: 1 }).limit(200).lean();
  return { tree: build(root, depth), children: children.map(summary) };
}

module.exports = { setPedigree, getTree, ancestors };
