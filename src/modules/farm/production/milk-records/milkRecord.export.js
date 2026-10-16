'use strict';
const AUDIT = require('../../../../constants/auditActions');
const { MILK_SHIFT_LABEL } = require('../../../../constants/production');
const MilkRecord = require('./milkRecord.model');
const svc = require('./milkRecord.service');
const audit = require('../../../../shared/audit/auditLog.service');
const { sendExport } = require('../../../../shared/export/excel.exporter');
const { buildSort } = require('../../../../utils/listQuery');
const { ymdOf } = require('../../../../utils/datetime');

const MAX_ROWS = 5000;

// Xuất theo 1 cá thể (cattleCode) hoặc toàn đàn, theo khoảng thời gian đang lọc; scope=all bỏ qua bộ lọc
async function exportMilkRecords(req, res, q) {
  const docs = await MilkRecord.find(svc.buildFilter(q.scope === 'all' ? {} : q)).sort(buildSort(q.sortBy, q.order)).limit(MAX_ROWS + 1).lean();
  const pens = await svc.loadPens(docs);
  const rows = docs.map((r) => ({
    cattleCode: r.cattleCode, date: ymdOf(r.date), shift: MILK_SHIFT_LABEL[r.shift], volumeLiters: r.volumeLiters,
    quality: r.quality || '', pen: pens.get(String(r.penId))?.code || '',
  }));
  const result = await sendExport(res, {
    format: q.format, base: 'san-luong-sua', sheetName: 'Sản lượng sữa', maxRows: MAX_ROWS, rows,
    columns: [
      { header: 'Mã bò', key: 'cattleCode', width: 14 }, { header: 'Ngày', key: 'date', width: 12 }, { header: 'Ca vắt', key: 'shift', width: 10 },
      { header: 'Sản lượng (lít)', key: 'volumeLiters', width: 16 }, { header: 'Chất lượng', key: 'quality', width: 20 }, { header: 'Chuồng', key: 'pen', width: 12 },
    ],
  });
  await audit.record(req, {
    action: AUDIT.EXPORT, module: 'production', entity: 'MilkRecord',
    meta: { format: q.format, scope: q.scope, rows: result.rows, filename: result.filename, filter: q.scope === 'all' ? null : { ...q, format: undefined, scope: undefined } },
  });
}

module.exports = { exportMilkRecords, MAX_ROWS };