'use strict';
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const ApiError = require('../../utils/ApiError');
const ImportSession = require('./importSession.model');
const { normalizeForSearch } = require('../../utils/vietnamese');

const IMPORT_MAX_ROWS = 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const badTemplate = (msg) => ApiError.unprocessable(msg, undefined, 'INVALID_TEMPLATE');

function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result); // ô công thức
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String(v.text).trim(); // hyperlink
    return String(v);
  }
  return typeof v === 'string' ? v.trim() : v;
}

// Ngày trong ô -> 'YYYY-MM-DD' hoặc null. Hỗ trợ ô ngày của Excel, YYYY-MM-DD và DD/MM/YYYY
function parseDateValue(v) {
  const pad = (x) => String(x).padStart(2, '0');
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

// Đọc .xlsx/.csv theo template. Sai template (thiếu cột bắt buộc, không đọc được) => từ chối cả file.
async function readTable(file, { required, optional = [], maxRows = IMPORT_MAX_ROWS }) {
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(file.originalname)) {
      const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
      // map tùy chỉnh: giữ nguyên chuỗi (mặc định exceljs đổi "007" thành 7 và "12/05" thành ngày)
      await wb.csv.read(Readable.from([text]), { map: (v) => (v === '' ? null : v), dateFormats: [] });
    } else {
      await wb.xlsx.load(file.buffer);
    }
  } catch {
    throw badTemplate('Không đọc được file, vui lòng dùng đúng template');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 1) throw badTemplate('File rỗng, vui lòng dùng đúng template');

  const known = new Map([...required, ...optional].map((h) => [normalizeForSearch(h), h]));
  const colOf = new Map(); // tên chuẩn -> số cột
  ws.getRow(1).eachCell((cell, col) => {
    const label = known.get(normalizeForSearch(String(cellValue(cell.value))));
    if (label && !colOf.has(label)) colOf.set(label, col);
  });
  const missing = required.filter((h) => !colOf.has(h));
  if (missing.length) throw badTemplate(`Sai định dạng template, thiếu cột: ${missing.join(', ')}`);

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const values = {};
    let any = false;
    for (const [label, col] of colOf) {
      const v = cellValue(ws.getRow(r).getCell(col).value);
      values[label] = v;
      if (v !== '') any = true;
    }
    if (any) rows.push({ rowNumber: r, values });
  }
  if (rows.length === 0) throw badTemplate('File không có dòng dữ liệu nào');
  if (rows.length > maxRows) {
    throw ApiError.unprocessable(`File có ${rows.length} dòng, tối đa ${maxRows} dòng mỗi lần import`, undefined, 'ROW_LIMIT_EXCEEDED');
  }
  return rows;
}

const createSession = ({ kind, userId, fileName, rows, summary, errors }) =>
  ImportSession.create([{ kind, createdBy: userId, fileName, rows, summary, rowErrors: errors, expiresAt: new Date(Date.now() + SESSION_TTL_MS) }]).then((a) => a[0]);

// Chỉ chủ phiên mới thấy phiên của mình
async function getSession(id, { kind, userId }) {
  const s = await ImportSession.findOne({ _id: id, kind, createdBy: userId });
  if (!s || s.expiresAt <= new Date()) throw ApiError.notFound('Phiên import không tồn tại hoặc đã hết hạn, vui lòng tải file lại', 'IMPORT_SESSION_NOT_FOUND');
  return s;
}

async function sendWorkbook(res, filename, build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  res.set({ 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

const sendTemplate = (res, { filename, headers, sample }) =>
  sendWorkbook(res, filename, (wb) => {
    const ws = wb.addWorksheet('Template');
    ws.addRow(headers).font = { bold: true };
    if (sample) ws.addRow(sample);
    headers.forEach((_, i) => (ws.getColumn(i + 1).width = 20));
  });

// File lỗi: số dòng + dữ liệu gốc + lý do, để sửa rồi import lại
const sendErrorFile = (res, { filename, headers, rows, errors }) =>
  sendWorkbook(res, filename, (wb) => {
    const ws = wb.addWorksheet('Dòng lỗi');
    ws.addRow(['Dòng', ...headers, 'Lý do lỗi']).font = { bold: true };
    const byRow = new Map(rows.map((r) => [r.rowNumber, r.values]));
    for (const e of errors) {
      const v = byRow.get(e.rowNumber) || {};
      ws.addRow([e.rowNumber, ...headers.map((h) => (v[h] instanceof Date ? v[h].toISOString().slice(0, 10) : v[h] ?? '')), e.messages.join('; ')]);
    }
    ws.getColumn(headers.length + 2).width = 60;
  });

module.exports = { IMPORT_MAX_ROWS, readTable, parseDateValue, createSession, getSession, sendTemplate, sendErrorFile };
