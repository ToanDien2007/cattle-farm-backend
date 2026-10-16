'use strict';
const AUDIT = require('../../../../constants/auditActions');
const { VACCINATION_STATUS_LABEL } = require('../../../../constants/health');
const Vaccination = require('./vaccination.model');
const svc = require('./vaccination.service');
const audit = require('../../../../shared/audit/auditLog.service');
const { sendExport } = require('../../../../shared/export/excel.exporter');
const { buildSort } = require('../../../../utils/listQuery');
const { ymdOf, todayYmdVN } = require('../../../../utils/datetime');

const MAX_ROWS = 5000;

async function exportVaccinations(req, res, q) {
  const filter = svc.buildFilter(q.scope === 'all' ? {} : q);
  const sortField = q.sortBy === 'nextDueDate' ? 'dueSort' : q.sortBy;
  const docs = await Vaccination.find(filter).sort(buildSort(sortField, q.order)).limit(MAX_ROWS + 1).lean();
  const today = todayYmdVN();
  const rows = docs.map((v) => ({
    cattleCode: v.cattleCode, vaccineType: v.vaccineType, vaccinationDate: ymdOf(v.vaccinationDate), dose: v.dose,
    nextDueDate: v.nextDueDate ? ymdOf(v.nextDueDate) : '', status: VACCINATION_STATUS_LABEL[svc.statusOf(v, today)], performedBy: v.performedBy,
  }));
  const result = await sendExport(res, {
    format: q.format, base: 'lich-su-tiem-phong', sheetName: 'Tiêm phòng', maxRows: MAX_ROWS, rows,
    columns: [
      { header: 'Mã bò', key: 'cattleCode', width: 14 }, { header: 'Loại vaccine', key: 'vaccineType', width: 24 },
      { header: 'Ngày tiêm', key: 'vaccinationDate', width: 12 }, { header: 'Liều lượng', key: 'dose', width: 14 },
      { header: 'Ngày tái tiêm', key: 'nextDueDate', width: 14 }, { header: 'Trạng thái', key: 'status', width: 14 },
      { header: 'Người thực hiện', key: 'performedBy', width: 20 },
    ],
  });
  await audit.record(req, { action: AUDIT.EXPORT, module: 'health', entity: 'Vaccination', meta: { format: q.format, scope: q.scope, rows: result.rows, filename: result.filename } });
}

module.exports = { exportVaccinations };