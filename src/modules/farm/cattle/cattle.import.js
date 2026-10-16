'use strict';
const AUDIT = require('../../../constants/auditActions');
const { SEX, ORIGIN } = require('../../../constants/cattleStatus');
const { BREED_STATUS } = require('../../../constants/farm');
const ApiError = require('../../../utils/ApiError');
const Cattle = require('./cattle.model');
const Breed = require('../breeds/breed.model');
const Pen = require('../pens/pen.model');
const ImportSession = require('../../../shared/import/importSession.model');
const imp = require('../../../shared/import/import.service');
const svc = require('./cattle.service');
const v = require('./cattle.validation');
const { occupancy } = require('../pens/penAssignment.service');
const audit = require('../../../shared/audit/auditLog.service');
const { withTransaction } = require('../../../utils/transaction');
const { normalizeForSearch } = require('../../../utils/vietnamese');
const { todayYmdVN } = require('../../../utils/datetime');

const KIND = 'cattle';
const REQUIRED = ['Mã bò', 'Số tai', 'Giống', 'Giới tính', 'Ngày sinh', 'Trọng lượng', 'Chuồng'];
const OPTIONAL = ['Nguồn gốc', 'Ngày nhập đàn']; // BRD: bắt buộc "Ngày nhập đàn" khi thêm bò nhưng template không có cột này => mặc định hôm nay
const HEADERS = [...REQUIRED.slice(0, 6), 'Nguồn gốc', 'Chuồng', 'Ngày nhập đàn'];
const FIELD_LABEL = { code: 'Mã bò', earTag: 'Số tai', breedId: 'Giống', sex: 'Giới tính', birthDate: 'Ngày sinh', weightKg: 'Trọng lượng', penId: 'Chuồng', origin: 'Nguồn gốc', joinDate: 'Ngày nhập đàn' };

const SEX_MAP = { duc: SEX.MALE, male: SEX.MALE, cai: SEX.FEMALE, female: SEX.FEMALE };
const ORIGIN_MAP = { 'sinh san': ORIGIN.BORN, born: ORIGIN.BORN, mua: ORIGIN.PURCHASED, purchased: ORIGIN.PURCHASED };
const str = (x) => (x == null ? '' : x instanceof Date ? '' : String(x).trim());

// Chạy toàn bộ dòng. dryRun=true: chỉ kiểm tra (preview). dryRun=false: tạo bò cho dòng hợp lệ, dòng lỗi bỏ qua (import một phần).
async function processRows(rows, { dryRun, actorId }) {
  const [breeds, pens] = await Promise.all([Breed.find({ status: BREED_STATUS.ACTIVE }).lean(), Pen.find({ deletedAt: null }).lean()]);
  const breedByKey = new Map(breeds.map((b) => [b.name.trim().toLowerCase(), b]));
  const penByCode = new Map(pens.map((p) => [p.code, p]));
  const occ = await occupancy();
  const added = new Map(); // số bò đã xếp thêm vào từng chuồng trong đợt này

  const codes = rows.map((r) => str(r.values['Mã bò']).toUpperCase()).filter(Boolean);
  const tags = rows.map((r) => str(r.values['Số tai']).toUpperCase()).filter(Boolean);
  const existing = await Cattle.find({ $or: [{ code: { $in: codes } }, { earTag: { $in: tags } }] }).select('code earTag').lean();
  const existCode = new Set(existing.map((e) => e.code)), existTag = new Set(existing.map((e) => e.earTag));
  const seenCode = new Map(), seenTag = new Map();

  const errors = [], sample = [];
  let valid = 0, success = 0;

  for (const row of rows) {
    const val = row.values;
    const msgs = [];
    const skip = new Set(); // trường đã báo lỗi riêng, không báo lại lỗi zod
    const bad = (field, msg) => { msgs.push(`${FIELD_LABEL[field]}: ${msg}`); skip.add(field); };
    const blank = (x) => x === '' || x == null;

    for (const [label, field] of [['Mã bò', 'code'], ['Số tai', 'earTag'], ['Giống', 'breedId'], ['Giới tính', 'sex'], ['Ngày sinh', 'birthDate'], ['Trọng lượng', 'weightKg'], ['Chuồng', 'penId']]) {
      if (blank(val[label])) bad(field, 'bắt buộc nhập');
    }
    const breed = blank(val['Giống']) ? null : breedByKey.get(str(val['Giống']).toLowerCase());
    if (!blank(val['Giống']) && !breed) bad('breedId', `"${str(val['Giống'])}" không tồn tại hoặc đã bị ẩn`);
    const pen = blank(val['Chuồng']) ? null : penByCode.get(str(val['Chuồng']).toUpperCase());
    if (!blank(val['Chuồng']) && !pen) bad('penId', `"${str(val['Chuồng'])}" không tồn tại`);

    const sex = blank(val['Giới tính']) ? undefined : SEX_MAP[normalizeForSearch(str(val['Giới tính']))];
    if (!blank(val['Giới tính']) && !sex) bad('sex', 'phải là Đực hoặc Cái');
    const origin = blank(val['Nguồn gốc']) ? undefined : ORIGIN_MAP[normalizeForSearch(str(val['Nguồn gốc']))];
    if (!blank(val['Nguồn gốc']) && !origin) bad('origin', 'phải là Sinh sản hoặc Mua');

    const birthDate = blank(val['Ngày sinh']) ? undefined : imp.parseDateValue(val['Ngày sinh']);
    if (!blank(val['Ngày sinh']) && !birthDate) bad('birthDate', 'không đọc được (dùng YYYY-MM-DD hoặc DD/MM/YYYY)');
    const joinDate = blank(val['Ngày nhập đàn']) ? todayYmdVN() : imp.parseDateValue(val['Ngày nhập đàn']);
    if (!blank(val['Ngày nhập đàn']) && !joinDate) bad('joinDate', 'không đọc được (dùng YYYY-MM-DD hoặc DD/MM/YYYY)');

    // Cùng quy tắc với API thêm bò (zod)
    const parsed = v.create.safeParse({
      code: str(val['Mã bò']), earTag: str(val['Số tai']), breedId: breed ? String(breed._id) : undefined, sex,
      birthDate, weightKg: val['Trọng lượng'], penId: pen ? String(pen._id) : undefined, origin, joinDate,
    });
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const f = i.path[0];
        if (skip.has(f) || (f === 'joinDate' && skip.has('birthDate'))) continue; // tránh báo lỗi dây chuyền
        const label = FIELD_LABEL[f] || f;
        msgs.push(i.message.startsWith(label) ? i.message : `${label}: ${i.message}`);
        skip.add(f);
      }
    }

    const body = parsed.success ? parsed.data : null;
    if (body) {
      if (existCode.has(body.code)) msgs.push('Mã bò: đã tồn tại trong hệ thống');
      else if (seenCode.has(body.code)) msgs.push(`Mã bò: trùng với dòng ${seenCode.get(body.code)} trong file`);
      if (existTag.has(body.earTag)) msgs.push('Số tai: đã tồn tại trong hệ thống');
      else if (seenTag.has(body.earTag)) msgs.push(`Số tai: trùng với dòng ${seenTag.get(body.earTag)} trong file`);
      if (pen) {
        const used = (occ[String(pen._id)] || 0) + (added.get(String(pen._id)) || 0);
        if (used >= pen.capacity) msgs.push(`Chuồng ${pen.code}: đã đầy (${used}/${pen.capacity})`);
      }
    }

    if (msgs.length || !body) { errors.push({ rowNumber: row.rowNumber, messages: msgs.length ? msgs : ['Dữ liệu không hợp lệ'] }); continue; }

    if (dryRun) {
      valid++;
      if (sample.length < 10) sample.push({ rowNumber: row.rowNumber, code: body.code, earTag: body.earTag, breed: breed.name, pen: pen.code, sex: body.sex, birthDate: body.birthDate, weightKg: body.weightKg });
    } else {
      try {
        // DB đã phản ánh các bò vừa tạo trong đợt này nên không cộng thêm `added` (tránh đếm đôi)
        await withTransaction((session) => svc.insertCattle(body, { actorId, session }));
        success++;
      } catch (err) {
        errors.push({ rowNumber: row.rowNumber, messages: [err.message || 'Không tạo được bò'] });
        continue;
      }
    }
    seenCode.set(body.code, row.rowNumber);
    seenTag.set(body.earTag, row.rowNumber);
    added.set(String(pen._id), (added.get(String(pen._id)) || 0) + 1);
  }

  const total = rows.length;
  return dryRun
    ? { summary: { total, valid, invalid: errors.length }, errors, sample }
    : { summary: { total, success, failed: errors.length }, errors };
}

const template = (res) =>
  imp.sendTemplate(res, {
    filename: 'mau-import-bo.xlsx',
    headers: HEADERS,
    sample: ['B001', 'TAG-0001', 'Brahman', 'Cái', '2024-03-15', 350.5, 'C01', 'Sinh sản', todayYmdVN()],
  });

// Bước 1: đọc file + chạy thử, chưa tạo gì
async function preview(req) {
  const rows = await imp.readTable(req.file, { required: REQUIRED, optional: OPTIONAL });
  const result = await processRows(rows, { dryRun: true, actorId: req.user._id });
  const session = await imp.createSession({ kind: KIND, userId: req.user._id, fileName: req.file.originalname, rows, summary: result.summary, errors: result.errors });
  return { sessionId: session._id, ...result };
}

// Bước 2: xác nhận. Kiểm tra lại toàn bộ lúc tạo thật vì dữ liệu có thể đổi sau lúc preview.
async function confirm(req, sessionId) {
  const session = await imp.getSession(sessionId, { kind: KIND, userId: req.user._id });
  const claimed = await ImportSession.findOneAndUpdate({ _id: session._id, status: 'PREVIEW' }, { $set: { status: 'CONFIRMED', confirmedAt: new Date() } });
  if (!claimed) throw ApiError.conflict('Phiên import đã được xác nhận trước đó', 'IMPORT_ALREADY_CONFIRMED');

  const result = await processRows(session.rows, { dryRun: false, actorId: req.user._id });
  await ImportSession.updateOne({ _id: session._id }, { $set: { summary: result.summary, rowErrors: result.errors } });
  await audit.record(req, { action: AUDIT.IMPORT, module: 'cattle', entity: 'Cattle', meta: { fileName: session.fileName, ...result.summary } });
  return { sessionId: session._id, ...result };
}

async function errorFile(req, res, sessionId) {
  const session = await imp.getSession(sessionId, { kind: KIND, userId: req.user._id });
  if (!session.rowErrors.length) throw ApiError.notFound('Phiên import không có dòng lỗi', 'NO_ERRORS');
  return imp.sendErrorFile(res, { filename: 'bo-dong-loi.xlsx', headers: HEADERS, rows: session.rows, errors: session.rowErrors });
}

module.exports = { HEADERS, processRows, template, preview, confirm, errorFile };
