'use strict';
// Chạy: node tests/manual/verifyMilk.js  (không cần MongoDB, xem helpers/harness.js)
const { start } = require('./helpers/harness');

(async () => {
  const h = await start();
  const { t, post, get, patch, del, fake, req, origLog } = h;
  const { todayYmdVN, ymdOf } = req('src/utils/datetime.js');
  const { addDaysYmd } = req('src/modules/farm/health/health.common.js');
  const referenceGuard = req('src/shared/referenceGuard.js');

  await fake.User.create({ fullName: 'Admin', email: 'root@farm.vn', role: 'ADMIN', passwordHash: await h.hash('Abcdef12') });
  await fake.User.create({ fullName: 'Khach', email: 'k@farm.vn', role: 'CUSTOMER', passwordHash: await h.hash('Abcdef12') });
  const login = async (id) => (await post('/auth/login', { identifier: id, password: 'Abcdef12' })).body.data.accessToken;
  const A = await login('root@farm.vn'), K = await login('k@farm.vn');
  const today = todayYmdVN();
  const d = (n) => addDaysYmd(today, n);
  const auditOf = (action) => fake.AuditLog.rows.filter((a) => a.action === action && a.module === 'production');
  const M = '/admin/farm/milk-records';
  const age = (hours) => fake.MilkRecord.rows.forEach((r) => { r.createdAt = new Date(Date.now() - hours * 3600e3); });
  let r;

  r = await get(M, K); t('khách hàng không vào được -> 403', r.status === 403);
  r = await get(M); t('không token -> 401', r.status === 401);

  // ---- nền: giống, 2 chuồng, 6 bò
  const breedId = (await post('/admin/farm/breeds', { name: 'Holstein' }, A)).body.data.id;
  const pen1 = (await post('/admin/farm/pens', { code: 'C01', name: 'Chuồng 1', capacity: 20, zone: 'A' }, A)).body.data.id;
  const pen2 = (await post('/admin/farm/pens', { code: 'C02', name: 'Chuồng 2', capacity: 20, zone: 'A' }, A)).body.data.id;
  const mk = async (code, penId) => {
    const x = await post('/admin/farm/cattle', { code, earTag: `T-${code}`, breedId, sex: 'FEMALE', birthDate: d(-800), weightKg: 300, penId, origin: 'BORN', joinDate: d(-100) }, A);
    if (x.status !== 201) throw new Error('seed bò lỗi: ' + JSON.stringify(x.body));
  };
  await mk('M001', pen1); await mk('M002', pen1); await mk('M003', pen2); await mk('M004', pen1); await mk('M005', pen1); await mk('M006', pen1);
  const cattle = (code) => fake.Cattle.rows.find((c) => c.code === code);
  const body = (o) => ({ cattleCode: 'M001', date: d(0), shift: 'MORNING', volumeLiters: 12.5, quality: 'Loại A', ...o });

  // ---- thêm
  r = await post(M, {}, A); t('tạo thiếu dữ liệu -> 422', r.status === 422 && ['cattleCode', 'date', 'shift', 'volumeLiters'].every((f) => r.body.error.details.some((x) => x.field === `body.${f}`)));
  r = await post(M, body({ volumeLiters: 0 }), A); t('sản lượng = 0 -> 422', r.status === 422 && r.body.error.details[0].field === 'body.volumeLiters');
  r = await post(M, body({ volumeLiters: -2 }), A); t('sản lượng âm -> 422', r.status === 422);
  r = await post(M, body({ volumeLiters: 'abc' }), A); t('sản lượng không phải số -> 422', r.status === 422);
  r = await post(M, body({ shift: 'NIGHT' }), A); t('ca vắt lạ -> 422', r.status === 422 && r.body.error.details[0].field === 'body.shift');
  r = await post(M, body({ date: d(1) }), A); t('ngày tương lai -> 422', r.status === 422);
  r = await post(M, body({ cattleCode: 'ZZZ' }), A); t('mã bò không tồn tại -> 422 CATTLE_NOT_FOUND', r.status === 422 && r.body.error.code === 'CATTLE_NOT_FOUND');
  r = await post(M, body({ date: d(-101) }), A); t('ngày trước ngày nhập đàn -> 422', r.status === 422 && r.body.error.details[0].field === 'body.date');

  r = await post(M, body({ cattleCode: 'm001', volumeLiters: '12,345' }), A); const a1 = r.body.data.id;
  t('thêm -> 201, mã viết hoa, làm tròn 2 số lẻ, kèm chuồng của bò', r.status === 201 && r.body.data.cattle.code === 'M001' && r.body.data.volumeLiters === 12.35 && r.body.data.pen.code === 'C01' && auditOf('CREATE').length === 1);
  r = await post(M, body(), A); t('trùng bò/ca/ngày -> 409 DUPLICATE_MILK_RECORD', r.status === 409 && r.body.error.code === 'DUPLICATE_MILK_RECORD');
  r = await post(M, body({ shift: 'AFTERNOON', volumeLiters: 9 }), A); const a2 = r.body.data.id; t('cùng bò, ca khác -> được', r.status === 201);
  r = await post(M, body({ date: d(-1), volumeLiters: 11 }), A); const a3 = r.body.data.id; t('cùng bò, ngày khác -> được', r.status === 201);
  r = await post(M, body({ cattleCode: 'M002', volumeLiters: 20 }), A); const a4 = r.body.data.id;
  r = await post(M, body({ cattleCode: 'M003', volumeLiters: 7.5, quality: '' }), A); const a5 = r.body.data.id; t('bò chuồng 2, chất lượng rỗng -> null', r.body.data.pen.code === 'C02' && r.body.data.quality === null);

  // ---- chặn theo trạng thái bò
  cattle('M004').status = 'TREATING';
  r = await post(M, body({ cattleCode: 'M004' }), A); t('bò Đang điều trị vẫn được ghi nhận (spec không chặn)', r.status === 201);
  cattle('M004').status = 'QUARANTINED';
  r = await post(M, body({ cattleCode: 'M004', shift: 'AFTERNOON' }), A); t('bò Đang cách ly -> 409 CATTLE_QUARANTINED', r.status === 409 && r.body.error.code === 'CATTLE_QUARANTINED');
  for (const [st, label] of [['SOLD', 'Đã bán'], ['DEAD', 'Đã chết'], ['REMOVED', 'Đã loại thải/không còn trong đàn']]) {
    cattle('M005').status = st;
    r = await post(M, body({ cattleCode: 'M005' }), A); t(`bò ${label} -> 409 CATTLE_NOT_OPERABLE`, r.status === 409 && r.body.error.code === 'CATTLE_NOT_OPERABLE');
  }
  cattle('M005').status = 'RAISING';

  // ---- danh sách / tìm / lọc / sắp xếp
  r = await get(M, A); t('list: tổng 6, mặc định ngày mới nhất trước, có tên chuồng', r.status === 200 && r.body.data.total === 6 && r.body.data.items.at(-1).id === a3 && r.body.data.items[0].pen.code);
  r = await get(M + '?q=m002', A); t('tìm theo mã bò', r.body.data.total === 1 && r.body.data.items[0].id === a4);
  r = await get(`${M}?penId=${pen2}`, A); t('lọc theo chuồng', r.body.data.total === 1 && r.body.data.items[0].id === a5);
  r = await get(`${M}?penId=${pen1},${pen2}`, A); t('lọc nhiều chuồng', r.body.data.total === 6);
  r = await get(M + '?penId=abc', A); t('penId sai định dạng -> 422', r.status === 422);
  r = await get(M + '?shift=AFTERNOON', A); t('lọc ca vắt', r.body.data.total === 1 && r.body.data.items[0].id === a2);
  r = await get(`${M}?dateFrom=${d(-1)}&dateTo=${d(-1)}`, A); t('lọc khoảng thời gian (1 ngày)', r.body.data.total === 1 && r.body.data.items[0].id === a3);
  r = await get(`${M}?dateFrom=${d(0)}&dateTo=${d(-3)}`, A); t('khoảng ngày ngược -> 422', r.status === 422);
  r = await get(M + '?cattleCode=m001&shift=MORNING', A); t('lọc 1 cá thể + ca', r.body.data.total === 2);
  r = await get(M + '?sortBy=volumeLiters&order=desc', A); t('sắp xếp sản lượng giảm dần', r.body.data.items[0].id === a4 && r.body.data.items[0].volumeLiters === 20);
  r = await get(M + '?sortBy=volumeLiters&order=asc', A); t('sắp xếp sản lượng tăng dần', r.body.data.items[0].volumeLiters === 7.5);
  r = await get(M + '?sortBy=quality', A); t('sortBy ngoài danh sách -> 422', r.status === 422);
  r = await get(M + '?page=1&limit=2', A); t('limit ngoài 10/20/50 -> 422', r.status === 422);
  r = await get(M + '?page=2&limit=10', A); t('phân trang: trang 2 rỗng, tổng vẫn 6, 1 trang', r.status === 200 && r.body.data.items.length === 0 && r.body.data.total === 6 && r.body.data.totalPages === 1);
  r = await get(`${M}/${a1}`, A); t('chi tiết: canEditFreely=true', r.status === 200 && r.body.data.canEditFreely === true && r.body.data.pen.code === 'C01');
  r = await get(`${M}/000000000000000000000000`, A); t('chi tiết không tồn tại -> 404', r.status === 404 && r.body.error.code === 'MILK_RECORD_NOT_FOUND');

  // ---- sửa
  r = await patch(`${M}/${a1}`, { volumeLiters: 13, quality: 'Loại B' }, A); t('sửa trong ngày -> 200', r.status === 200 && r.body.data.volumeLiters === 13 && r.body.data.quality === 'Loại B');
  r = await patch(`${M}/${a1}`, { quality: '' }, A); t('chất lượng rỗng -> xóa', r.status === 200 && r.body.data.quality === null);
  r = await patch(`${M}/${a1}`, { volumeLiters: 0 }, A); t('sửa sản lượng 0 -> 422', r.status === 422);
  r = await patch(`${M}/${a1}`, {}, A); t('sửa rỗng -> 422', r.status === 422);
  r = await patch(`${M}/${a1}`, { confirmAmendment: true }, A); t('chỉ gửi xác nhận -> 422', r.status === 422);
  r = await patch(`${M}/${a1}`, { cattleCode: 'M002' }, A); t('đổi bò -> 422 CATTLE_IMMUTABLE', r.status === 422 && r.body.error.code === 'CATTLE_IMMUTABLE');
  r = await patch(`${M}/${a1}`, { shift: 'AFTERNOON' }, A); t('đổi sang ca/ngày đã có bản ghi -> 409', r.status === 409 && r.body.error.code === 'DUPLICATE_MILK_RECORD');
  r = await patch(`${M}/${a1}`, { date: d(-2) }, A); t('đổi ngày sang ngày trống -> 200', r.status === 200 && ymdOf(r.body.data.date) === d(-2));
  r = await patch(`${M}/${a1}`, { date: d(-101) }, A); t('đổi ngày trước ngày nhập đàn -> 422', r.status === 422);
  r = await patch(`${M}/${a1}`, { date: d(1) }, A); t('đổi ngày sang tương lai -> 422', r.status === 422);
  r = await patch(`${M}/${a1}`, { volumeLiters: 13 }, A); t('sửa giữ nguyên ca/ngày của chính nó không báo trùng', r.status === 200);
  t('audit UPDATE có before/after', auditOf('UPDATE').length >= 1 && auditOf('UPDATE')[0].before.volumeLiters === 12.35 && auditOf('UPDATE')[0].after.volumeLiters === 13);
  r = await patch(`${M}/000000000000000000000000`, { volumeLiters: 1 }, A); t('sửa bản ghi không tồn tại -> 404', r.status === 404);

  age(25); // qua ngày hôm sau
  r = await get(`${M}/${a2}`, A); t('chi tiết sau ngày ghi nhận: canEditFreely=false', r.body.data.canEditFreely === false);
  r = await patch(`${M}/${a2}`, { volumeLiters: 10 }, A); t('qua ngày, không xác nhận -> 409 AMENDMENT_CONFIRMATION_REQUIRED', r.status === 409 && r.body.error.code === 'AMENDMENT_CONFIRMATION_REQUIRED');
  r = await patch(`${M}/${a2}`, { volumeLiters: 10, confirmAmendment: true }, A); t('qua ngày, xác nhận nhưng thiếu lý do -> 422', r.status === 422 && r.body.error.details[0].field === 'body.amendReason');
  r = await patch(`${M}/${a2}`, { volumeLiters: 10, confirmAmendment: true, amendReason: 'Nhập nhầm số' }, A);
  t('qua ngày, xác nhận + lý do -> 200, lưu điều chỉnh + audit có lý do', r.status === 200 && r.body.data.volumeLiters === 10 && fake.MilkRecord.rows.find((x) => String(x._id) === a2).amendments.length === 1 && auditOf('UPDATE').at(-1).meta.amendReason === 'Nhập nhầm số');

  // ---- xóa
  r = await del(`${M}/${a4}`, A); t('xóa bản ghi quá 24h -> 409 MILK_DELETE_WINDOW_EXPIRED', r.status === 409 && r.body.error.code === 'MILK_DELETE_WINDOW_EXPIRED');
  r = await post(M, body({ cattleCode: 'M006', volumeLiters: 5 }), A); const n1 = r.body.data.id;
  r = await post(M, body({ cattleCode: 'M006', shift: 'AFTERNOON', volumeLiters: 6 }), A); const n2 = r.body.data.id;
  r = await del(`${M}/${n1}`, A); t('xóa bản ghi mới (<24h) -> 200 xóa mềm', r.status === 200 && r.body.data.deleted[0].mode === 'SOFT');
  const rowN1 = fake.MilkRecord.rows.find((x) => String(x._id) === n1);
  t('còn trong DB với deletedAt/deletedBy, ẩn khỏi list/chi tiết, audit DELETE', !!rowN1.deletedAt && !!rowN1.deletedBy && (await get(`${M}/${n1}`, A)).status === 404 && (await get(M + '?cattleCode=M006', A)).body.data.total === 1 && auditOf('DELETE').length === 1);
  r = await post(M, body({ cattleCode: 'M006', volumeLiters: 5.5 }), A); t('xóa nhầm rồi nhập lại cùng bò/ca/ngày -> được', r.status === 201);
  r = await del(`${M}/${n1}`, A); t('xóa lại -> 404', r.status === 404);
  r = await post(M + '/bulk-delete', { ids: [n2, a4, '000000000000000000000001'] }, A);
  t('xóa nhiều: 1 thành công, 2 thất bại có mã lý do', r.status === 200 && r.body.data.deleted.length === 1 && r.body.data.failed.map((f) => f.code).sort().join() === 'MILK_DELETE_WINDOW_EXPIRED,MILK_RECORD_NOT_FOUND');
  r = await post(M + '/bulk-delete', { ids: [] }, A); t('xóa nhiều không chọn gì -> 422', r.status === 422);

  // ---- export
  r = await get(M + '/export?format=csv&cattleCode=M001', A); let csv = r.buf?.toString('utf8') || '';
  t('export csv 1 cá thể: BOM, tiêu đề tiếng Việt, ca Sáng/Chiều, chỉ bò M001', r.status === 200 && csv.charCodeAt(0) === 0xfeff && csv.includes('Sản lượng (lít)') && csv.includes('Sáng') && csv.includes('M001') && !csv.includes('M002'));
  r = await get(`${M}/export?format=csv&dateFrom=${d(-1)}&dateTo=${d(-1)}`, A); csv = r.buf?.toString('utf8') || '';
  t('export theo khoảng thời gian đang lọc', r.status === 200 && csv.includes(d(-1)) && !csv.includes(d(-2)));
  r = await get(M + '/export?scope=all&format=csv&cattleCode=ZZZ', A); csv = r.buf?.toString('utf8') || '';
  t('scope=all bỏ qua bộ lọc (toàn đàn)', r.status === 200 && csv.includes('M002') && csv.includes('M003') && csv.includes('C02'));
  r = await get(M + '/export?cattleCode=ZZZ', A); t('không có dữ liệu -> 422 NO_DATA_TO_EXPORT', r.status === 422 && r.body.error.code === 'NO_DATA_TO_EXPORT');
  r = await get(M + '/export', A); t('export xlsx mặc định + audit EXPORT', r.status === 200 && (r.headers.get('content-type') || '').includes('spreadsheetml') && auditOf('EXPORT').length === 4);

  t('referenceGuard: bò có bản ghi sản lượng sữa', (await referenceGuard.referencesOf('Cattle', [String(cattle('M002')._id)]))[String(cattle('M002')._id)]?.some((x) => x.label === 'bản ghi sản lượng sữa'));

  h.close(); origLog(`\n${h.passed()} kiểm tra đạt`); process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });