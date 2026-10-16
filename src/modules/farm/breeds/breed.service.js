'use strict';
const ApiError = require('../../../utils/ApiError');
const AUDIT = require('../../../constants/auditActions');
const { BREED_STATUS } = require('../../../constants/farm');
const { IN_HERD } = require('../../../constants/cattleStatus');
const Breed = require('./breed.model');
const Cattle = require('../cattle/cattle.model');
const audit = require('../../../shared/audit/auditLog.service');
const { paginate, searchFilter, buildSort, andFilter } = require('../../../utils/listQuery');

const MODULE = 'breeds';
const notFound = () => ApiError.notFound('Không tìm thấy dữ liệu', 'BREED_NOT_FOUND');
const nameTaken = (hidden) =>
  ApiError.conflict(hidden ? 'Tên giống đã tồn tại (giống đang bị ẩn, hãy khôi phục thay vì tạo mới)' : 'Tên giống đã tồn tại', 'BREED_NAME_TAKEN');

// Số bò đang trong đàn thuộc từng giống
async function countCattle(ids) {
  const rows = await Cattle.aggregate([
    { $match: { breedId: { $in: ids }, status: { $in: IN_HERD } } },
    { $group: { _id: '$breedId', count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
}

const toItem = (b, counts) => ({
  id: b._id,
  name: b.name,
  description: b.description,
  characteristics: b.characteristics,
  image: b.image,
  status: b.status,
  cattleCount: counts[String(b._id)] || 0,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

async function list(q) {
  const filter = andFilter({}, searchFilter(q.q), q.status && { status: { $in: q.status } });
  const res = await paginate(Breed, { filter, sort: buildSort(q.sortBy, q.order), page: q.page, limit: q.limit });
  const counts = await countCattle(res.items.map((b) => b._id));
  return { ...res, items: res.items.map((b) => toItem(b, counts)) };
}

async function getById(id) {
  const b = await Breed.findOne({ _id: id }).lean();
  if (!b) throw notFound();
  return toItem(b, await countCattle([b._id]));
}

async function create(req, body) {
  const dup = await Breed.findOne({ nameKey: body.name.toLowerCase() });
  if (dup) throw nameTaken(dup.status === BREED_STATUS.HIDDEN);
  const [b] = await Breed.create([body]);
  const item = toItem(b, {});
  await audit.record(req, { action: AUDIT.CREATE, module: MODULE, entity: 'Breed', entityId: b._id, after: item });
  return item;
}

// Đổi tên áp dụng ngay cho mọi bò thuộc giống (bò tham chiếu theo ID nên không cần cập nhật bò)
async function update(req, id, body) {
  const b = await Breed.findOne({ _id: id });
  if (!b) throw notFound();
  if (b.status === BREED_STATUS.HIDDEN) throw ApiError.conflict('Giống bò đã bị ẩn, không thể sửa', 'RECORD_CONFLICT');

  const dup = await Breed.findOne({ nameKey: body.name.toLowerCase(), _id: { $ne: id } });
  if (dup) throw nameTaken(dup.status === BREED_STATUS.HIDDEN);

  const before = toItem(b, {});
  Object.assign(b, body);
  await b.save();
  const after = toItem(b, await countCattle([b._id]));
  await audit.record(req, { action: AUDIT.UPDATE, module: MODULE, entity: 'Breed', entityId: id, before, after });
  return after;
}

// Xóa mềm = ẩn (khỏi danh sách chọn khi thêm bò). Không cho xóa nếu còn bò thuộc giống.
// Trả kết quả từng giống để xóa hàng loạt báo rõ lý do từng dòng.
async function remove(req, ids) {
  const found = await Breed.find({ _id: { $in: ids } });
  const byId = new Map(found.map((b) => [String(b._id), b]));
  const counts = await countCattle(found.map((b) => b._id));
  const deleted = [], failed = [];

  for (const id of ids) {
    const b = byId.get(id);
    if (!b) { failed.push({ id, code: 'BREED_NOT_FOUND', reason: 'Giống bò không tồn tại' }); continue; }
    if (b.status === BREED_STATUS.HIDDEN) { failed.push({ id, name: b.name, code: 'ALREADY_HIDDEN', reason: 'Giống bò đã bị ẩn trước đó' }); continue; }
    if (counts[id] > 0) {
      failed.push({ id, name: b.name, code: 'BREED_IN_USE', reason: `Không thể xóa: đang có ${counts[id]} bò thuộc giống "${b.name}"` });
      continue;
    }
    const before = toItem(b, {});
    b.status = BREED_STATUS.HIDDEN;
    b.hiddenAt = new Date();
    await b.save();
    deleted.push({ id, mode: 'HIDDEN' });
    await audit.record(req, { action: AUDIT.DELETE, module: MODULE, entity: 'Breed', entityId: id, before, after: { status: b.status } });
  }
  return { deleted, failed };
}

// Bổ sung ngoài BRD: khôi phục giống đã ẩn (nếu không thì tên giống bị giữ vĩnh viễn)
async function restore(req, id) {
  const b = await Breed.findOne({ _id: id });
  if (!b) throw notFound();
  if (b.status !== BREED_STATUS.HIDDEN) throw ApiError.conflict('Giống bò đang được sử dụng', 'NOT_HIDDEN');
  b.status = BREED_STATUS.ACTIVE;
  b.hiddenAt = undefined;
  await b.save();
  await audit.record(req, { action: AUDIT.RESTORE, module: MODULE, entity: 'Breed', entityId: id, after: { status: b.status } });
  return toItem(b, await countCattle([b._id]));
}

module.exports = { list, getById, create, update, remove, restore };
