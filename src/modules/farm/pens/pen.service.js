'use strict';
const ApiError = require('../../../utils/ApiError');
const AUDIT = require('../../../constants/auditActions');
const { IN_HERD } = require('../../../constants/cattleStatus');
const Pen = require('./pen.model');
const PenAssignment = require('./penAssignment.model');
const Cattle = require('../cattle/cattle.model');
const { occupancy, fillStatus, fillPercent } = require('./penAssignment.service');
const audit = require('../../../shared/audit/auditLog.service');
const { searchFilter, andFilter } = require('../../../utils/listQuery');

const MODULE = 'pens';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'PEN_NOT_FOUND');
const codeTaken = () => ApiError.conflict('Mã chuồng đã tồn tại', 'PEN_CODE_TAKEN');
const live = { deletedAt: null };

const toItem = (p, occ) => {
  const count = occ[String(p._id)] || 0;
  return {
    id: p._id, code: p.code, name: p.name, zone: p.zone, type: p.type, capacity: p.capacity,
    currentCount: count, fillPercent: fillPercent(count, p.capacity), fillStatus: fillStatus(count, p.capacity),
  };
};

// Số bò hiện có và % lấp đầy là giá trị tính ra nên lọc/sắp xếp/phân trang thực hiện trong bộ nhớ (số chuồng nhỏ)
async function list(q) {
  const filter = andFilter(live, searchFilter(q.q), q.zone && { zone: { $in: q.zone } }, q.type && { type: { $in: q.type } });
  const pens = await Pen.find(filter).lean();
  const occ = await occupancy(pens.map((p) => p._id));
  let items = pens.map((p) => toItem(p, occ));
  if (q.fill) items = items.filter((i) => q.fill.includes(i.fillStatus));

  const dir = q.order === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const d = a[q.sortBy] === b[q.sortBy] ? 0 : a[q.sortBy] > b[q.sortBy] ? 1 : -1;
    return d !== 0 ? d * dir : a.code < b.code ? -1 : 1;
  });

  const total = items.length;
  return { items: items.slice((q.page - 1) * q.limit, q.page * q.limit), page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

async function getById(id) {
  const p = await Pen.findOne({ _id: id, ...live }).lean();
  if (!p) throw notFound();
  const occ = await occupancy([p._id]);
  const cattle = await Cattle.find({ penId: p._id, status: { $in: IN_HERD } }).sort({ code: 1 }).lean();
  return { ...toItem(p, occ), cattle: cattle.map((c) => ({ id: c._id, code: c.code, name: c.name, status: c.status, sex: c.sex })) };
}

async function create(req, body) {
  if (await Pen.exists({ code: body.code })) throw codeTaken();
  const [p] = await Pen.create([body]);
  const item = toItem(p, {});
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'Pen', entityId: p._id, after: item });
  return item;
}

async function update(req, id, body) {
  const p = await Pen.findOne({ _id: id, ...live });
  if (!p) throw notFound();
  if (body.code && body.code !== p.code && (await Pen.exists({ code: body.code, _id: { $ne: id } }))) throw codeTaken();

  const count = (await occupancy([p._id]))[String(p._id)] || 0;
  if (body.capacity !== undefined && body.capacity < count) {
    throw ApiError.conflict(`Không thể giảm sức chứa xuống dưới số bò hiện đang ở trong chuồng (${count} bò)`, 'CAPACITY_BELOW_OCCUPANCY');
  }

  const before = toItem(p, { [String(p._id)]: count });
  for (const [k, v] of Object.entries(body)) p[k] = v === '' ? undefined : v;
  await p.save();
  const after = toItem(p, { [String(p._id)]: count });
  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'Pen', entityId: id, before, after });
  return after;
}

// Chỉ xóa khi chuồng không còn bò. Chuồng chưa từng có bò => xóa cứng; đã có lịch sử chuyển chuồng => xóa mềm (deletedAt)
async function remove(req, ids) {
  const pens = await Pen.find({ _id: { $in: ids }, ...live });
  const byId = new Map(pens.map((p) => [String(p._id), p]));
  const occ = await occupancy(pens.map((p) => p._id));
  const deleted = [], failed = [];

  for (const id of ids) {
    const p = byId.get(id);
    if (!p) { failed.push({ id, code: 'PEN_NOT_FOUND', reason: 'Chuồng không tồn tại hoặc đã bị xóa' }); continue; }
    if (occ[id] > 0) { failed.push({ id, name: p.code, code: 'PEN_NOT_EMPTY', reason: `Không thể xóa chuồng ${p.code}: còn ${occ[id]} bò` }); continue; }

    const before = toItem(p, {});
    const hasHistory = await PenAssignment.exists({ $or: [{ toPenId: p._id }, { fromPenId: p._id }] });
    if (hasHistory) {
      p.deletedAt = new Date();
      await p.save();
    } else {
      await Pen.deleteOne({ _id: p._id });
    }
    deleted.push({ id, mode: hasHistory ? 'SOFT' : 'HARD' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'Pen', entityId: id, before, after: { mode: hasHistory ? 'SOFT' : 'HARD' } });
  }
  return { deleted, failed };
}

module.exports = { list, getById, create, update, remove };
