'use strict';
const ExcelJS = require('exceljs');
const ApiError = require('../../utils/ApiError');
const { formatStampVN } = require('../../utils/datetime');

const EXPORT_MAX_ROWS = 50000;
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

// Chống CSV/formula injection khi mở bằng Excel
const csvSafe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

// columns: [{ header, key, width }]; rows: mảng object theo key. File: <base>_<YYYYMMDD_HHmmss>.<xlsx|csv>
async function sendExport(res, { format = 'xlsx', base, sheetName, columns, rows, maxRows = EXPORT_MAX_ROWS }) {
  if (!rows.length) throw ApiError.unprocessable('Không có dữ liệu theo điều kiện hiện tại để xuất', undefined, 'NO_DATA_TO_EXPORT');
  if (rows.length > maxRows) {
    throw ApiError.unprocessable(`Tối đa ${maxRows} dòng mỗi lần xuất, hãy thu hẹp bộ lọc`, undefined, 'EXPORT_TOO_LARGE');
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName || 'Data');
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 20 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(format === 'csv' ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, csvSafe(v)])) : r);
  }

  let buf;
  if (format === 'csv') buf = Buffer.concat([Buffer.from('\uFEFF'), Buffer.from(await wb.csv.writeBuffer())]); // BOM để Excel đọc đúng tiếng Việt
  else buf = Buffer.from(await wb.xlsx.writeBuffer());

  const filename = `${base}_${formatStampVN()}.${format}`;
  res.set({ 'Content-Type': MIME[format], 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send(buf);
  return { filename, rows: rows.length };
}

module.exports = { sendExport, EXPORT_MAX_ROWS };
