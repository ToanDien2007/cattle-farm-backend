'use strict';
// Chạy: node tests/manual/verifyMeat.js  (không cần MongoDB, xem helpers/harness.js)
const { start } = require('./helpers/harness');

(async () => {
  const h = await start();
  const { t, post, get, patch, del, fake, req, origLog } = h;
  const { todayYmdVN, ymdOf } = req('src/utils/datetime.js');
  const { addDaysYmd } = req('src/modules/farm/health/health.common.js');
  const referenceGuard = req('src/shared/referenceGuard.js');
  const { markBatchTransferred } = req('src/modules/farm/production/meat-records/meatRecord.service.js');

  await fake.User.create({ fullName: 'Admin', email: 'root@farm.vn', role: 'ADMIN', passwordHash: await h.hash('Abcdef12') });
  await fake.User.create({ fullName: 'Khach', email: 'k@farm.vn', role: 'CUSTOMER', passwordHash: await h.hash('Abcdef12') });
  const login = async (id) => (await post('/auth/login', { identifier: id, password: 'Abcdef12' })).body.data.accessToken;
  const A = await login('root@farm.vn'), K = await login('k@farm.vn');
  const today = todayYmdVN();
  const d = (n) => addDaysYmd(today, n);
  const auditOf = (action) => fake.AuditLog.rows.filter((a) => a.action === action && a.entity === 'MeatRecord');
  const T = '/admin/farm/meat-records';
  let r;

  r = await get(T, K); t('khách hàng không vào được -> 403', r.status === 403);
  r = await get(T); t('không token -> 401', r.status === 401);

  // ---- nền: 6 bò
  const breedId = (await post('/admin/farm/breeds', { name: 'Angus' }, A)).body.data.id;
  const penId = (await post('/admin/farm/pens', { code: 'C01', name: 'Chuồng 1', capacity: 20, zone: 'A' }, A)).body.data.id;
  for (const code of ['T001', 'T002', 'T003', 'T004', 'T005', 'T006']) {
    const x = await post('/admin/farm/cattle', { code, earTag: `E-${code}`, breedId, sex: 'MALE', birthDate: d(-900), weightKg: 450, penId, origin: 'BORN', joinDate: d(-300) }, A);
    if (x.status !== 201) throw new Error('seed bò lỗi: ' + JSON.stringify(x.body));
  }
  const cattle = (code) => fake.Cattle.rows.find((c) => c.code === code);
  const sold = (...codes) => codes.forEach((c) => { cattle(c).status = 'SOLD'; });
  sold('T001', 'T002', 'T003', 'T006');
  const body = (o) => ({ cattleCode: 'T001', weightKg: 250.5, exportDate: d(-2), productType: 'FRESH', batchCode: 'lo-01', ...o });

  // sản lượng sữa cho T001 trước khi bán (để kiểm tra chi tiết bò)
  cattle('T001').status = 'RAISING';
  r = await post('/admin/farm/milk-records', { cattleCode: 'T001', date: d(-5), shift: 'MORNING', volumeLiters: 10 }, A); t('(chuẩn bị) bản ghi sữa của T001', r.status === 201);
  sold('T001');

  // ---- thêm
  r = await post(T, {}, A); t('tạo thiếu dữ liệu -> 422', r.status === 422 && ['cattleCode', 'weightKg', 'exportDate', 'batchCode'].every((f) => r.body.error.details.some((x) => x.field === `body.${f}`)));
  r = await post(T, body({ weightKg: 0 }), A); t('trọng lượng = 0 -> 422', r.status === 422 && r.body.error.details[0].field === 'body.weightKg');
  r = await post(T, body({ weightKg: -5 }), A); t('trọng lượng âm -> 422', r.status === 422);
  r = await post(T, body({ productType: 'RAW' }), A); t('loại sản phẩm lạ -> 422', r.status === 422 && r.body.error.details[0].field === 'body.productType');
  r = await post(T, body({ batchCode: '  ' }), A); t('lô sản xuất rỗng -> 422', r.status === 422 && r.body.error.details[0].field === 'body.batchCode');
  r = await post(T, body({ exportDate: '2026-13-40' }), A); t('ngày xuất sai định dạng -> 422', r.status === 422);
  r = await post(T, body({ cattleCode: 'ZZZ' }), A); t('mã bò không tồn tại -> 422 CATTLE_NOT_FOUND', r.status === 422 && r.body.error.code === 'CATTLE_NOT_FOUND');
  for (const [st, label] of [['RAISING', 'Đang nuôi'], ['TREATING', 'Đang điều trị'], ['QUARANTINED', 'Đang cách ly'], ['DEAD', 'Đã chết'], ['REMOVED', 'Không còn trong đàn']]) {
    cattle('T004').status = st;
    r = await post(T, body({ cattleCode: 'T004' }), A); t(`bò ${label} -> 409 CATTLE_NOT_SOLD`, r.status === 409 && r.body.error.code === 'CATTLE_NOT_SOLD');
  }

  r = await post(T, body({ cattleCode: 't001', weightKg: '250,555' }), A); const m1 = r.body.data.id;
  t('thêm bò Đã bán -> 201, mã & lô viết hoa, làm tròn, trạng thái Nháp', r.status === 201 && r.body.data.cattle.code === 'T001' && r.body.data.batchCode === 'LO-01' && r.body.data.weightKg === 250.56 && r.body.data.status === 'DRAFT' && auditOf('CREATE').length === 1);
  r = await post(T, body({ cattleCode: 'T002', weightKg: 300, productType: 'PROCESSED', exportDate: d(-1) }), A); const m2 = r.body.data.id;
  r = await post(T, body({ cattleCode: 'T003', weightKg: 280, productType: undefined, batchCode: 'LO-02', exportDate: d(0) }), A); const m3 = r.body.data.id; t('loại sản phẩm không bắt buộc -> null', r.status === 201 && r.body.data.productType === null);
  r = await post(T, body({ cattleCode: 'T006', weightKg: 100, batchCode: 'LO-02', exportDate: d(-10) }), A); const m4 = r.body.data.id;

  // ---- danh sách / tìm / lọc / sắp xếp
  r = await get(T, A); t('list: 4 bản ghi, mặc định ngày xuất mới nhất trước', r.status === 200 && r.body.data.total === 4 && r.body.data.items[0].id === m3 && r.body.data.items[3].id === m4);
  r = await get(T + '?q=lo-02', A); t('tìm theo lô sản xuất', r.body.data.total === 2);
  r = await get(T + '?q=t002', A); t('tìm theo mã bò', r.body.data.total === 1 && r.body.data.items[0].id === m2);
  r = await get(T + '?productType=PROCESSED', A); t('lọc loại sản phẩm', r.body.data.total === 1 && r.body.data.items[0].id === m2);
  r = await get(T + '?productType=FRESH,PROCESSED', A); t('lọc nhiều loại (bản ghi không có loại bị loại)', r.body.data.total === 3);
  r = await get(T + '?productType=RAW', A); t('lọc loại sai -> 422', r.status === 422);
  r = await get(`${T}?dateFrom=${d(-2)}&dateTo=${d(-1)}`, A); t('lọc khoảng thời gian (gồm 2 đầu mút)', r.body.data.total === 2);
  r = await get(`${T}?dateFrom=${d(0)}&dateTo=${d(-5)}`, A); t('khoảng ngày ngược -> 422', r.status === 422);
  r = await get(T + '?batchCode=lo-02', A); t('lọc theo lô (không phân biệt hoa thường)', r.body.data.total === 2);
  r = await get(T + '?sortBy=weightKg&order=desc', A); t('sắp xếp trọng lượng giảm dần', r.body.data.items[0].weightKg === 300);
  r = await get(T + '?limit=5', A); t('limit ngoài 10/20/50 -> 422', r.status === 422);
  r = await get(`${T}/${m1}`, A); t('chi tiết đủ trường', r.status === 200 && r.body.data.batchCode === 'LO-01' && r.body.data.productType === 'FRESH');
  r = await get(`${T}/000000000000000000000000`, A); t('chi tiết không tồn tại -> 404', r.status === 404 && r.body.error.code === 'MEAT_RECORD_NOT_FOUND');

  // ---- sửa
  r = await patch(`${T}/${m1}`, { weightKg: 260, productType: 'PROCESSED', batchCode: 'lo-03', exportDate: d(-3) }, A);
  t('sửa bản ghi nháp -> 200', r.status === 200 && r.body.data.weightKg === 260 && r.body.data.productType === 'PROCESSED' && r.body.data.batchCode === 'LO-03' && ymdOf(r.body.data.exportDate) === d(-3));
  r = await patch(`${T}/${m1}`, { productType: null }, A); t('productType=null -> xóa loại', r.status === 200 && r.body.data.productType === null);
  r = await patch(`${T}/${m1}`, { weightKg: 0 }, A); t('sửa trọng lượng 0 -> 422', r.status === 422);
  r = await patch(`${T}/${m1}`, {}, A); t('sửa rỗng -> 422', r.status === 422);
  r = await patch(`${T}/${m1}`, { cattleCode: 'T002' }, A); t('đổi bò -> 422 CATTLE_IMMUTABLE', r.status === 422 && r.body.error.code === 'CATTLE_IMMUTABLE');
  r = await patch(`${T}/000000000000000000000000`, { weightKg: 1 }, A); t('sửa bản ghi không tồn tại -> 404', r.status === 404);
  t('audit UPDATE có before/after', auditOf('UPDATE').length >= 1 && auditOf('UPDATE')[0].before.weightKg === 250.56 && auditOf('UPDATE')[0].after.weightKg === 260);

  // ---- lô đã xuất kho
  await markBatchTransferred('lo-02', { outputProductId: '000000000000000000000009' });
  const row3 = fake.MeatRecord.rows.find((x) => String(x._id) === m3);
  t('markBatchTransferred: cả lô LO-02 chuyển Đã xuất kho, lô khác không bị ảnh hưởng', row3.status === 'TRANSFERRED' && !!row3.transferredAt && fake.MeatRecord.rows.find((x) => String(x._id) === m4).status === 'TRANSFERRED' && fake.MeatRecord.rows.find((x) => String(x._id) === m1).status === 'DRAFT');
  r = await patch(`${T}/${m3}`, { weightKg: 1 }, A); t('sửa bản ghi lô đã xuất kho -> 409 MEAT_RECORD_LOCKED', r.status === 409 && r.body.error.code === 'MEAT_RECORD_LOCKED');
  r = await del(`${T}/${m3}`, A); t('xóa bản ghi lô đã xuất kho -> 409 MEAT_RECORD_LOCKED', r.status === 409 && r.body.error.code === 'MEAT_RECORD_LOCKED');
  r = await post(T, body({ cattleCode: 'T002', batchCode: 'lo-02' }), A); t('thêm bản ghi vào lô đã xuất kho -> 409 BATCH_TRANSFERRED', r.status === 409 && r.body.error.code === 'BATCH_TRANSFERRED');
  r = await patch(`${T}/${m2}`, { batchCode: 'LO-02' }, A); t('chuyển bản ghi nháp sang lô đã xuất kho -> 409 BATCH_TRANSFERRED', r.status === 409 && r.body.error.code === 'BATCH_TRANSFERRED');
  r = await get(T + '?batchCode=LO-02', A); t('bản ghi đã xuất kho hiển thị trạng thái TRANSFERRED', r.body.data.items.every((x) => x.status === 'TRANSFERRED'));

  // ---- xóa
  r = await del(`${T}/${m2}`, A); t('xóa bản ghi nháp -> 200 xóa mềm', r.status === 200 && r.body.data.deleted[0].mode === 'SOFT');
  const row2 = fake.MeatRecord.rows.find((x) => String(x._id) === m2);
  t('còn trong DB với deletedAt/deletedBy, ẩn khỏi list/chi tiết, audit DELETE', !!row2.deletedAt && !!row2.deletedBy && (await get(`${T}/${m2}`, A)).status === 404 && (await get(T, A)).body.data.total === 3 && auditOf('DELETE').length === 1);
  r = await del(`${T}/${m2}`, A); t('xóa lại -> 404', r.status === 404);
  r = await post(T + '/bulk-delete', { ids: [m1, m3, m4, '000000000000000000000001'] }, A);
  t('xóa nhiều: 1 thành công, 3 thất bại (2 khóa + 1 không tồn tại)', r.status === 200 && r.body.data.deleted.length === 1 && r.body.data.failed.map((f) => f.code).sort().join() === 'MEAT_RECORD_LOCKED,MEAT_RECORD_LOCKED,MEAT_RECORD_NOT_FOUND');
  r = await post(T + '/bulk-delete', { ids: [] }, A); t('xóa nhiều không chọn gì -> 422', r.status === 422);

  // ---- export
  r = await post(T, body({ cattleCode: 'T001', batchCode: 'LO-09', weightKg: 111, exportDate: d(-4) }), A);
  r = await get(T + '/export?format=csv&batchCode=lo-02', A); let csv = r.buf?.toString('utf8') || '';
  t('export csv theo lô: BOM, tiêu đề tiếng Việt, chỉ lô LO-02, trạng thái Đã xuất kho', r.status === 200 && csv.charCodeAt(0) === 0xfeff && csv.includes('Trọng lượng xuất (kg)') && csv.includes('LO-02') && !csv.includes('LO-09') && csv.includes('Đã xuất kho'));
  r = await get(`${T}/export?format=csv&dateFrom=${d(-4)}&dateTo=${d(-4)}`, A); csv = r.buf?.toString('utf8') || '';
  t('export theo khoảng thời gian', r.status === 200 && csv.includes('LO-09') && !csv.includes('LO-02'));
  r = await get(T + '/export?scope=all&format=csv&batchCode=ZZZ', A); csv = r.buf?.toString('utf8') || '';
  t('scope=all bỏ qua bộ lọc', r.status === 200 && csv.includes('LO-09') && csv.includes('LO-02'));
  r = await get(T + '/export?batchCode=ZZZ', A); t('không có dữ liệu -> 422 NO_DATA_TO_EXPORT', r.status === 422 && r.body.error.code === 'NO_DATA_TO_EXPORT');
  r = await get(T + '/export', A); t('export xlsx mặc định + audit EXPORT', r.status === 200 && (r.headers.get('content-type') || '').includes('spreadsheetml') && auditOf('EXPORT').length === 4);

  // ---- tích hợp
  r = await get(`/admin/farm/cattle/${cattle('T001')._id}`, A);
  t('chi tiết bò: production.milk (1) và production.meat (1 bản ghi LO-09)', r.status === 200 && r.body.data.production.milk.length === 1 && r.body.data.production.meat.length === 1 && r.body.data.production.meat[0].batchCode === 'LO-09');
  t('referenceGuard: bò có bản ghi sản lượng thịt', (await referenceGuard.referencesOf('Cattle', [String(cattle('T001')._id)]))[String(cattle('T001')._id)]?.some((x) => x.label === 'bản ghi sản lượng thịt'));

  h.close(); origLog(`\n${h.passed()} kiểm tra đạt`); process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });