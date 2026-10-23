'use strict';
const AUDIT = require('../../../../constants/auditActions');
const { MEAT_PRODUCT_TYPE_LABEL, MEAT_STATUS_LABEL } = require('../../../../constants/production');
const MeatRecord = require('./meatRecord.model');
const svc = require('./meatRecord.service');
const audit = require('../../../../shared/audit/auditLog.service');
const { sendExport } = require('../../../../shared/export/excel.exporter');
const { buildSort } = require('../../../../utils/listQuery');
const { ymdOf } = require('../../../../utils/datetime');

const MAX_ROWS = 5000;

// Xuất theo lô sản xuất (batchCode) hoặc theo khoảng thời gian đang lọc; scope=all bỏ qua bộ lọc
async function exportMeatRecords(req, res, q) {
  const docs = await MeatRecord.find(svc.buildFilter(q.scope === 'all' ? {} : q)).sort(buildSort(q.sortBy, q.order)).limit(MAX_ROWS + 1).lean();
  const rows = docs.map((r) => ({
    cattleCode: r.cattleCode, weightKg: r.weightKg, exportDate: ymdOf(r.exportDate), productType: r.productType ? MEAT_PRODUCT_TYPE_LABEL[r.productType] : '',
    batchCode: r.batchCode, status: MEAT_STATUS_LABEL[r.status],
  }));
  const result = await sendExport(res, {
    format: q.format, base: 'san-luong-thit', sheetName: 'Sản lượng thịt', maxRows: MAX_ROWS, rows,
    columns: [
      { header: 'Mã bò', key: 'cattleCode', width: 14 }, { header: 'Trọng lượng xuất (kg)', key: 'weightKg', width: 22 }, { header: 'Ngày xuất', key: 'exportDate', width: 12 },
      { header: 'Loại sản phẩm', key: 'productType', width: 16 }, { header: 'Lô sản xuất', key: 'batchCode', width: 16 }, { header: 'Trạng thái', key: 'status', width: 14 },
    ],
  });
  await audit.record(req, {
    action: AUDIT.EXPORT, module: 'production', entity: 'MeatRecord',
    meta: { format: q.format, scope: q.scope, rows: result.rows, filename: result.filename, filter: q.scope === 'all' ? null : { ...q, format: undefined, scope: undefined } },
  });
}

module.exports = { exportMeatRecords, MAX_ROWS };