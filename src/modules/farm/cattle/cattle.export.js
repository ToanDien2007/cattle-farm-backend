'use strict';
const AUDIT = require('../../../constants/auditActions');
const { CATTLE_STATUS_LABEL, SEX_LABEL } = require('../../../constants/cattleStatus');
const Cattle = require('./cattle.model');
const svc = require('./cattle.service');
const audit = require('../../../shared/audit/auditLog.service');
const { sendExport } = require('../../../shared/export/excel.exporter');
const { buildSort } = require('../../../utils/listQuery');
const { ymdOf } = require('../../../utils/datetime');

const MAX_ROWS = 5000; // BRD: tối đa 5.000 dòng mỗi lần xuất

// scope=all: toàn bộ; scope=filtered: theo bộ lọc hiện tại (gồm khoảng ngày nhập đàn)
async function exportCattle(req, res, q) {
  const filter = q.scope === 'all' ? {} : svc.buildFilter(q);
  const docs = await Cattle.find(filter).sort(buildSort(q.sortBy, q.order)).limit(MAX_ROWS + 1).lean();
  const refs = await svc.loadRefs(docs);

  const rows = docs.map((c) => {
    const i = svc.toItem(c, refs);
    return {
      code: i.code, earTag: i.earTag, name: i.name || '', breed: i.breed?.name || '', pen: i.pen ? `${i.pen.code} - ${i.pen.name}` : '',
      sex: SEX_LABEL[i.sex], birthDate: ymdOf(i.birthDate), ageMonths: i.ageMonths, weightKg: i.weightKg,
      status: CATTLE_STATUS_LABEL[i.status], image: i.image || '', note: i.note || '',
    };
  });

  const result = await sendExport(res, {
    format: q.format, base: 'danh-sach-bo', sheetName: 'Bò', maxRows: MAX_ROWS, rows,
    columns: [
      { header: 'Mã bò', key: 'code', width: 14 }, { header: 'Số tai/RFID', key: 'earTag', width: 16 }, { header: 'Tên', key: 'name', width: 20 },
      { header: 'Giống', key: 'breed', width: 20 }, { header: 'Chuồng', key: 'pen', width: 22 }, { header: 'Giới tính', key: 'sex', width: 10 },
      { header: 'Ngày sinh', key: 'birthDate', width: 12 }, { header: 'Tuổi (tháng)', key: 'ageMonths', width: 12 },
      { header: 'Trọng lượng (kg)', key: 'weightKg', width: 16 }, { header: 'Trạng thái', key: 'status', width: 20 },
      { header: 'Hình ảnh', key: 'image', width: 30 }, { header: 'Ghi chú', key: 'note', width: 30 },
    ],
  });
  await audit.record(req, {
    action: AUDIT.EXPORT, module: 'cattle', entity: 'Cattle',
    meta: { format: q.format, scope: q.scope, rows: result.rows, filename: result.filename, filter: q.scope === 'all' ? null : { ...q, format: undefined, scope: undefined } },
  });
}

module.exports = { exportCattle, MAX_ROWS };
