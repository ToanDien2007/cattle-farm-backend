'use strict';
const AUDIT = require('../../../../constants/auditActions');
const { CONCLUSION_LABEL, HEALTH_RULES } = require('../../../../constants/health');
const HealthRecord = require('./healthRecord.model');
const svc = require('./healthRecord.service');
const audit = require('../../../../shared/audit/auditLog.service');
const { sendExport } = require('../../../../shared/export/excel.exporter');
const { buildSort } = require('../../../../utils/listQuery');
const { ymdOf, todayYmdVN, shiftMonthsVN } = require('../../../../utils/datetime');

const MAX_ROWS = 5000;

// BRD: xuất theo 1 cá thể (cattleCode) hoặc toàn đàn, chỉ lấy dữ liệu 2 năm gần nhất mỗi lần xuất
async function exportHealthRecords(req, res, q) {
  const since = shiftMonthsVN(todayYmdVN(), -HEALTH_RULES.EXPORT_MAX_MONTHS);
  const filter = svc.buildFilter(q.scope === 'all' ? {} : q, { since });
  const docs = await HealthRecord.find(filter).sort(buildSort(q.sortBy, q.order)).limit(MAX_ROWS + 1).lean();

  const rows = docs.map((r) => ({
    cattleCode: r.cattleCode, examDate: ymdOf(r.examDate), symptoms: r.symptoms || '', diagnosis: r.diagnosis || '',
    treatment: r.treatment || '', medication: r.medication || '', weightKg: r.weightKg ?? '', performedBy: r.performedBy,
    conclusion: r.conclusion ? CONCLUSION_LABEL[r.conclusion] : '',
  }));

  const result = await sendExport(res, {
    format: q.format, base: 'ho-so-kham-suc-khoe', sheetName: 'Hồ sơ khám', maxRows: MAX_ROWS, rows,
    columns: [
      { header: 'Mã bò', key: 'cattleCode', width: 14 }, { header: 'Ngày khám', key: 'examDate', width: 12 },
      { header: 'Triệu chứng', key: 'symptoms', width: 30 }, { header: 'Chẩn đoán', key: 'diagnosis', width: 26 },
      { header: 'Phương pháp điều trị', key: 'treatment', width: 30 }, { header: 'Thuốc sử dụng', key: 'medication', width: 26 },
      { header: 'Cân nặng (kg)', key: 'weightKg', width: 14 }, { header: 'Người thực hiện', key: 'performedBy', width: 20 },
      { header: 'Kết luận', key: 'conclusion', width: 16 },
    ],
  });
  await audit.record(req, {
    action: AUDIT.EXPORT, module: 'health', entity: 'HealthRecord',
    meta: { format: q.format, scope: q.scope, rows: result.rows, filename: result.filename, since, filter: q.scope === 'all' ? null : { ...q, format: undefined, scope: undefined } },
  });
}

module.exports = { exportHealthRecords, MAX_ROWS };