'use strict';
// Chạy: node tests/manual/verifyHealth.js  (không cần MongoDB, xem helpers/harness.js)
const { start } = require('./helpers/harness');

(async () => {
  const h = await start();
  const { t, post, get, patch, del, fake, req, origLog } = h;
  const { todayYmdVN, ymdOf } = req('src/utils/datetime.js');
  const { addDaysYmd } = req('src/modules/farm/health/health.common.js');
  const { VACCINE_CONTRAINDICATIONS } = req('src/constants/health.js');
  const referenceGuard = req('src/shared/referenceGuard.js');
  const { assertNotQuarantined } = req('src/modules/farm/health/quarantine/quarantine.service.js');

  await fake.User.create({ fullName: 'Admin', email: 'root@farm.vn', role: 'ADMIN', passwordHash: await h.hash('Abcdef12') });
  await fake.User.create({ fullName: 'Khach', email: 'k@farm.vn', role: 'CUSTOMER', passwordHash: await h.hash('Abcdef12') });
  const login = async (id) => (await post('/auth/login', { identifier: id, password: 'Abcdef12' })).body.data.accessToken;
  const A = await login('root@farm.vn'), K = await login('k@farm.vn');
  const today = todayYmdVN();
  const d = (n) => addDaysYmd(today, n);
  const auditOf = (action, module) => fake.AuditLog.rows.filter((a) => a.action === action && (!module || a.module === module));
  const H = '/admin/farm/health-records', V = '/admin/farm/vaccinations', Q = '/admin/farm/quarantines';
  const age = (rows, hours) => rows.forEach((r) => { r.createdAt = new Date(Date.now() - hours * 3600e3); });
  let r;

  r = await get(H, K); t('khách hàng không vào được -> 403', r.status === 403);
  r = await get(V); t('không token -> 401', r.status === 401);

  // ---- dữ liệu nền: giống, chuồng, 6 con bò
  const breedId = (await post('/admin/farm/breeds', { name: 'Brahman' }, A)).body.data.id;
  const penId = (await post('/admin/farm/pens', { code: 'C01', name: 'Chuồng 1', capacity: 20, zone: 'A' }, A)).body.data.id;
  for (const code of ['B001', 'B002', 'B003', 'B004', 'B005', 'B006']) {
    r = await post('/admin/farm/cattle', { code, earTag: `T-${code}`, breedId, sex: 'FEMALE', birthDate: d(-800), weightKg: 300, penId, origin: 'BORN', joinDate: d(-700) }, A);
    if (r.status !== 201) throw new Error('seed bò lỗi: ' + JSON.stringify(r.body));
  }
  const cattle = (code) => fake.Cattle.rows.find((c) => c.code === code);

  // ================= HỒ SƠ KHÁM =================
  r = await post(H, {}, A); t('tạo thiếu dữ liệu -> 422 báo cattleCode, examDate, performedBy', r.status === 422 && ['cattleCode', 'examDate', 'performedBy'].every((f) => r.body.error.details.some((x) => x.field === `body.${f}`)));
  r = await post(H, { cattleCode: 'B001', examDate: d(1), performedBy: 'BS Lan' }, A); t('ngày khám tương lai -> 422', r.status === 422 && r.body.error.details[0].message.includes('lớn hơn ngày hiện tại'));
  r = await post(H, { cattleCode: 'B001', examDate: d(0), performedBy: 'BS Lan', weightKg: -3 }, A); t('cân nặng âm -> 422', r.status === 422 && r.body.error.details[0].field === 'body.weightKg');
  r = await post(H, { cattleCode: 'B001', examDate: d(0), performedBy: 'BS Lan', conclusion: 'LA' }, A); t('kết luận lạ -> 422', r.status === 422);
  r = await post(H, { cattleCode: 'ZZZ', examDate: d(0), performedBy: 'BS Lan' }, A); t('mã bò không tồn tại -> 422 CATTLE_NOT_FOUND', r.status === 422 && r.body.error.code === 'CATTLE_NOT_FOUND');

  r = await post(H, { cattleCode: 'b001', examDate: d(-10), symptoms: 'Sốt, bỏ ăn', diagnosis: 'Viêm phổi', treatment: 'Kháng sinh', medication: 'Penicillin', weightKg: 310.5, performedBy: 'BS Lan', conclusion: 'SICK' }, A);
  t('khám kết luận Bệnh -> 201, mã bò viết hoa, bò chuyển Đang điều trị', r.status === 201 && r.body.data.cattle.code === 'B001' && r.body.data.cattleStatus === 'TREATING' && cattle('B001').status === 'TREATING');
  const hr1 = r.body.data.id;
  t('có lịch sử trạng thái + audit STATUS_CHANGE + audit CREATE', fake.CattleStatusHistory.rows.some((x) => String(x.cattleId) === String(cattle('B001')._id) && x.to === 'TREATING') && auditOf('STATUS_CHANGE', 'cattle').length === 1 && auditOf('CREATE', 'health').length === 1);

  r = await post(H, { cattleCode: 'B001', examDate: d(-20), diagnosis: 'Khám định kỳ cũ', performedBy: 'BS Lan', conclusion: 'HEALTHY' }, A);
  t('hồ sơ Khỏe mạnh nhưng KHÔNG phải lần khám mới nhất -> không đổi trạng thái bò', r.status === 201 && cattle('B001').status === 'TREATING');
  r = await post(H, { cattleCode: 'B001', examDate: d(-5), diagnosis: 'Theo dõi', performedBy: 'BS Lan', conclusion: 'MONITORING' }, A);
  t('Cần theo dõi -> giữ nguyên trạng thái', r.status === 201 && cattle('B001').status === 'TREATING');
  r = await post(H, { cattleCode: 'B002', examDate: d(-3), diagnosis: 'Ổn', performedBy: 'BS Hà', conclusion: 'HEALTHY' }, A);
  t('Khỏe mạnh khi bò đang Đang nuôi -> không đổi', r.status === 201 && cattle('B002').status === 'RAISING');
  const hr2 = r.body.data.id;

  r = await get(H, A); t('list: 4 hồ sơ, sắp xếp ngày khám giảm dần', r.status === 200 && r.body.data.total === 4 && r.body.data.items[0].cattle.code === 'B002' && r.body.data.items[3].examDate < r.body.data.items[0].examDate);
  r = await get(H + '?q=viem phoi', A); t('tìm theo chẩn đoán không dấu', r.body.data.total === 1 && r.body.data.items[0].id === hr1);
  r = await get(H + '?q=b002', A); t('tìm theo mã bò', r.body.data.total === 1);
  r = await get(H + '?conclusion=SICK,HEALTHY', A); t('lọc kết luận nhiều giá trị', r.body.data.total === 3);
  r = await get(H + '?conclusion=XYZ', A); t('lọc kết luận sai -> 422', r.status === 422);
  r = await get(`${H}?cattleCode=b001&examFrom=${d(-12)}&examTo=${d(-5)}`, A); t('lọc 1 cá thể + khoảng ngày (gồm 2 đầu mút)', r.body.data.total === 2);
  r = await get(`${H}?examFrom=${d(0)}&examTo=${d(-5)}`, A); t('khoảng ngày ngược -> 422', r.status === 422);
  r = await get(H + '?sortBy=examDate&order=asc', A); t('sắp xếp tăng dần', r.body.data.items[0].diagnosis === 'Khám định kỳ cũ');
  r = await get(`${H}/${hr1}`, A); t('chi tiết: đủ trường + lịch sử khám của cùng bò (2 hồ sơ khác) + canEditFreely', r.status === 200 && r.body.data.medication === 'Penicillin' && r.body.data.history.length === 2 && r.body.data.canEditFreely === true);
  r = await get(`${H}/000000000000000000000000`, A); t('chi tiết không tồn tại -> 404', r.status === 404 && r.body.error.code === 'HEALTH_RECORD_NOT_FOUND');
  r = await get(`${H}/abc`, A); t('id sai định dạng -> 422', r.status === 422);

  r = await patch(`${H}/${hr1}`, { treatment: 'Kháng sinh 7 ngày', weightKg: 312 }, A); t('sửa trong 24h -> 200', r.status === 200 && r.body.data.treatment === 'Kháng sinh 7 ngày' && r.body.data.weightKg === 312);
  r = await patch(`${H}/${hr1}`, { cattleCode: 'B002' }, A); t('đổi bò -> 422 CATTLE_IMMUTABLE', r.status === 422 && r.body.error.code === 'CATTLE_IMMUTABLE');
  r = await patch(`${H}/${hr1}`, {}, A); t('sửa rỗng -> 422', r.status === 422);
  r = await patch(`${H}/${hr1}`, { confirmAmendment: true }, A); t('chỉ gửi xác nhận, không có dữ liệu -> 422', r.status === 422);
  r = await patch(`${H}/${hr1}`, { performedBy: '' }, A); t('xóa người thực hiện -> 422', r.status === 422);
  r = await patch(`${H}/${hr1}`, { medication: '' }, A); t('gửi chuỗi rỗng = xóa thuốc', r.status === 200 && r.body.data.medication === null);
  t('audit UPDATE có before/after', auditOf('UPDATE', 'health').length >= 1 && auditOf('UPDATE', 'health')[0].before.treatment === 'Kháng sinh' && auditOf('UPDATE', 'health')[0].after.treatment === 'Kháng sinh 7 ngày');

  age(fake.HealthRecord.rows, 25);
  r = await patch(`${H}/${hr1}`, { diagnosis: 'Viêm phổi cấp' }, A); t('quá 24h không xác nhận -> 409 AMENDMENT_CONFIRMATION_REQUIRED', r.status === 409 && r.body.error.code === 'AMENDMENT_CONFIRMATION_REQUIRED');
  r = await patch(`${H}/${hr1}`, { diagnosis: 'Viêm phổi cấp', confirmAmendment: true }, A); t('quá 24h xác nhận nhưng thiếu lý do -> 422', r.status === 422 && r.body.error.details[0].field === 'body.amendReason');
  r = await patch(`${H}/${hr1}`, { diagnosis: 'Viêm phổi cấp', confirmAmendment: true, amendReason: 'Có kết quả xét nghiệm' }, A);
  t('quá 24h có xác nhận + lý do -> 200, lưu bổ sung', r.status === 200 && fake.HealthRecord.rows.find((x) => String(x._id) === hr1).amendments.length === 1);
  r = await get(`${H}/${hr1}`, A); t('chi tiết quá 24h: canEditFreely=false, có amendments, tìm theo chẩn đoán mới được', r.body.data.canEditFreely === false && r.body.data.amendments[0].reason === 'Có kết quả xét nghiệm' && (await get(H + '?q=cap', A)).body.data.total === 1);

  // khám Khỏe mạnh mới nhất -> bò về Đang nuôi
  r = await post(H, { cattleCode: 'B001', examDate: d(0), diagnosis: 'Đã khỏi', performedBy: 'BS Lan', conclusion: 'HEALTHY' }, A);
  t('khám Khỏe mạnh mới nhất khi đang điều trị -> bò về Đang nuôi', r.status === 201 && r.body.data.cattleStatus === 'RAISING' && cattle('B001').status === 'RAISING');

  // bò đã bán / đã chết
  cattle('B006').status = 'SOLD';
  r = await post(H, { cattleCode: 'B006', examDate: d(0), performedBy: 'BS Lan' }, A); t('bò Đã bán -> 409 không cho thêm hồ sơ', r.status === 409);
  cattle('B006').status = 'DEAD';
  r = await post(H, { cattleCode: 'B006', examDate: d(0), performedBy: 'BS Lan' }, A); t('bò Đã chết -> 409', r.status === 409);
  cattle('B006').status = 'RAISING';

  // xóa mềm
  r = await del(`${H}/${hr2}`, A); t('xóa 1 hồ sơ -> 200 (xóa mềm)', r.status === 200 && r.body.data.deleted[0].mode === 'SOFT');
  const row2 = fake.HealthRecord.rows.find((x) => String(x._id) === hr2);
  t('còn trong DB với deletedAt/deletedBy, ẩn khỏi list/chi tiết, audit DELETE', !!row2.deletedAt && !!row2.deletedBy && (await get(H, A)).body.data.total === 4 && (await get(`${H}/${hr2}`, A)).status === 404 && auditOf('DELETE', 'health').length === 1);
  r = await del(`${H}/${hr2}`, A); t('xóa lại -> 404', r.status === 404);
  const live = fake.HealthRecord.rows.filter((x) => !x.deletedAt).map((x) => String(x._id));
  r = await post(H + '/bulk-delete', { ids: [live[0], live[1], hr2, '000000000000000000000001'] }, A);
  t('xóa nhiều: 2 thành công, 2 thất bại có lý do', r.status === 200 && r.body.data.deleted.length === 2 && r.body.data.failed.length === 2 && r.body.data.failed[0].code === 'HEALTH_RECORD_NOT_FOUND');
  r = await post(H + '/bulk-delete', { ids: [] }, A); t('xóa nhiều không chọn gì -> 422', r.status === 422);
  t('referenceGuard: bò có hồ sơ khám (kể cả đã xóa mềm) -> có tham chiếu', (await referenceGuard.referencesOf('Cattle', [String(cattle('B002')._id)]))[String(cattle('B002')._id)]?.some((x) => x.label === 'hồ sơ khám sức khỏe'));

  // export (2 năm gần nhất)
  await post(H, { cattleCode: 'B003', examDate: d(-400), diagnosis: 'Khám trong 2 năm', performedBy: 'BS Hà', conclusion: 'HEALTHY' }, A);
  await post(H, { cattleCode: 'B003', examDate: d(-900), diagnosis: 'Khám quá 2 năm', performedBy: 'BS Hà', conclusion: 'HEALTHY' }, A);
  r = await get(H + '/export?format=csv&cattleCode=B003', A); let csv = r.buf?.toString('utf8') || '';
  t('export csv 1 cá thể: có BOM, tiêu đề tiếng Việt, chỉ 2 năm gần nhất', r.status === 200 && csv.charCodeAt(0) === 0xfeff && csv.includes('Mã bò') && csv.includes('Khám trong 2 năm') && !csv.includes('Khám quá 2 năm') && csv.includes('Khỏe mạnh'));
  r = await get(H + '/export?scope=all&format=csv&cattleCode=B999', A); csv = r.buf?.toString('utf8') || '';
  t('scope=all bỏ qua bộ lọc nhưng vẫn giới hạn 2 năm', r.status === 200 && csv.includes('Khám trong 2 năm') && !csv.includes('Khám quá 2 năm'));
  r = await get(H + '/export?cattleCode=B999', A); t('không có dữ liệu -> 422 NO_DATA_TO_EXPORT', r.status === 422 && r.body.error.code === 'NO_DATA_TO_EXPORT');
  r = await get(H + '/export', A); t('export xlsx mặc định', r.status === 200 && (r.headers.get('content-type') || '').includes('spreadsheetml') && auditOf('EXPORT', 'health').length === 3);

  // ================= TIÊM PHÒNG =================
  r = await post(V, {}, A); t('tạo thiếu dữ liệu -> 422', r.status === 422 && ['cattleCode', 'vaccineType', 'vaccinationDate', 'dose', 'performedBy'].every((f) => r.body.error.details.some((x) => x.field === `body.${f}`)));
  const vb = (o) => ({ cattleCode: 'B004', vaccineType: 'Lở mồm long móng', vaccinationDate: d(-60), dose: '2ml', performedBy: 'BS Lan', ...o });
  r = await post(V, vb({ vaccinationDate: d(1) }), A); t('ngày tiêm tương lai -> 422', r.status === 422);
  r = await post(V, vb({ nextDueDate: d(10), intervalDays: 30 }), A); t('nhập cả nextDueDate và intervalDays -> 422', r.status === 422 && r.body.error.details[0].field === 'body.intervalDays');
  r = await post(V, vb({ nextDueDate: d(-61) }), A); t('ngày tái tiêm trước ngày tiêm -> 422', r.status === 422 && r.body.error.details[0].field === 'body.nextDueDate');
  r = await post(V, vb({ intervalDays: 0 }), A); t('chu kỳ 0 -> 422', r.status === 422);
  r = await post(V, vb({ cattleCode: 'ZZZ' }), A); t('mã bò không tồn tại -> 422', r.status === 422 && r.body.error.code === 'CATTLE_NOT_FOUND');

  r = await post(V, vb({ nextDueDate: d(-10) }), A); const v1 = r.body.data.id;
  t('lịch tái tiêm đã qua -> Quá hạn', r.status === 201 && r.body.data.status === 'OVERDUE' && ymdOf(r.body.data.nextDueDate) === d(-10));
  r = await post(V, vb({ cattleCode: 'B005', vaccineType: 'Tụ huyết trùng', intervalDays: 33, vaccinationDate: d(-30) }), A); const v2 = r.body.data.id;
  t('intervalDays tự tính ngày tái tiêm = ngày tiêm + 33 = hôm nay + 3 -> Sắp đến hạn', ymdOf(r.body.data.nextDueDate) === d(3) && r.body.data.status === 'DUE_SOON');
  r = await post(V, vb({ cattleCode: 'B005', vaccineType: 'Brucella', vaccinationDate: d(-1), nextDueDate: d(100) }), A); const v3 = r.body.data.id;
  t('tái tiêm còn xa -> Đã tiêm', r.body.data.status === 'DONE');
  r = await post(V, vb({ cattleCode: 'B002', vaccineType: 'Phó thương hàn', vaccinationDate: d(-5) }), A); const v4 = r.body.data.id;
  t('không có lịch tái tiêm -> Đã tiêm', r.body.data.status === 'DONE' && r.body.data.nextDueDate === null);

  r = await get(V, A); t('list mặc định: theo ngày tái tiêm tăng dần, bản ghi không có lịch xếp cuối', r.body.data.total === 4 && r.body.data.items[0].id === v1 && r.body.data.items[1].id === v2 && r.body.data.items[3].id === v4);
  r = await get(V + '?status=OVERDUE', A); t('lọc Quá hạn', r.body.data.total === 1 && r.body.data.items[0].id === v1);
  r = await get(V + '?status=OVERDUE,DUE_SOON', A); t('lọc nhiều trạng thái', r.body.data.total === 2);
  r = await get(V + '?status=DONE', A); t('lọc Đã tiêm', r.body.data.total === 2);
  r = await get(V + '?vaccineType=tu%20huyet%20trung,brucella', A); t('lọc loại vaccine (không dấu, nhiều giá trị)', r.body.data.total === 2);
  r = await get(V + '?q=B005', A); t('tìm theo mã bò', r.body.data.total === 2);
  r = await get(V + '?q=pho%20thuong', A); t('tìm theo loại vaccine không dấu', r.body.data.total === 1);
  r = await get(`${V}?dateFrom=${d(-31)}&dateTo=${d(-1)}`, A); t('lọc khoảng Ngày tiêm', r.body.data.total === 3);
  r = await get(V + '?sortBy=vaccinationDate&order=desc', A); t('sắp xếp theo ngày tiêm giảm dần', r.body.data.items[0].id === v3 && r.body.data.items[3].id === v1);

  // tái tiêm thay thế lịch cũ
  r = await post(V, vb({ vaccinationDate: d(0), nextDueDate: d(180) }), A); const v5 = r.body.data.id;
  r = await get(V + '?status=OVERDUE', A); t('tiêm lại cùng loại -> lịch cũ hết Quá hạn', r.body.data.total === 0);
  r = await post(V, vb({ vaccinationDate: d(-30), nextDueDate: d(-5) }), A); t('bản ghi tiêm bù (ngày cũ hơn lần đã có) -> không bị Quá hạn', r.status === 201 && r.body.data.status === 'DONE');
  const vBack = r.body.data.id;
  r = await del(`${V}/${v5}`, A); t('xóa bản ghi tiêm lại (trong 24h) -> 200', r.status === 200);
  r = await get(V + '?status=OVERDUE', A); t('xóa lần tiêm sau -> chỉ lần tiêm bù (mới nhất còn lại) Quá hạn, v1 đã được nó thay thế', r.body.data.total === 1 && r.body.data.items[0].id === vBack);
  await del(`${V}/${vBack}`, A);
  r = await get(V + '?status=OVERDUE', A); t('xóa nốt -> v1 Quá hạn trở lại', r.body.data.total === 1 && r.body.data.items[0].id === v1);

  // cập nhật
  r = await patch(`${V}/${v4}`, { dose: '3ml', intervalDays: 365 }, A); t('sửa liều + chu kỳ -> 200, tính lại ngày tái tiêm', r.status === 200 && r.body.data.dose === '3ml' && ymdOf(r.body.data.nextDueDate) === d(360));
  r = await patch(`${V}/${v4}`, { nextDueDate: null }, A); t('nextDueDate=null -> bỏ lịch tái tiêm', r.status === 200 && r.body.data.nextDueDate === null);
  r = await patch(`${V}/${v4}`, { cattleCode: 'B001' }, A); t('đổi bò -> 422', r.status === 422 && r.body.error.code === 'CATTLE_IMMUTABLE');
  r = await patch(`${V}/${v4}`, { nextDueDate: d(-30) }, A); t('ngày tái tiêm < ngày tiêm khi sửa -> 422', r.status === 422);
  r = await patch(`${V}/${v4}`, {}, A); t('sửa rỗng -> 422', r.status === 422);
  r = await patch(`${V}/000000000000000000000000`, { dose: '1ml' }, A); t('sửa bản ghi không tồn tại -> 404', r.status === 404);
  r = await patch(`${V}/${v4}`, { vaccinationDate: d(-6) }, A); t('sửa ngày tiêm trong 48h -> 200', r.status === 200 && ymdOf(r.body.data.vaccinationDate) === d(-6));
  age(fake.Vaccination.rows, 49);
  r = await patch(`${V}/${v4}`, { vaccinationDate: d(-7) }, A); t('sửa Ngày tiêm sau 48h -> 409 VACCINATION_DATE_LOCKED', r.status === 409 && r.body.error.code === 'VACCINATION_DATE_LOCKED');
  r = await patch(`${V}/${v4}`, { dose: '4ml' }, A); t('sau 48h vẫn sửa được trường khác', r.status === 200);
  r = await post(V + '/bulk-delete', { ids: [v4, v1] }, A); t('quá 24h không được xóa -> failed VACCINATION_DELETE_WINDOW_EXPIRED', r.status === 200 && r.body.data.deleted.length === 0 && r.body.data.failed.every((f) => f.code === 'VACCINATION_DELETE_WINDOW_EXPIRED'));
  r = await del(`${V}/${v4}`, A); t('xóa đơn quá 24h -> 409', r.status === 409 && r.body.error.code === 'VACCINATION_DELETE_WINDOW_EXPIRED');

  // chống chỉ định cùng ngày
  VACCINE_CONTRAINDICATIONS.push(['Vaccine X', 'Vaccine Y']);
  r = await post(V, vb({ cattleCode: 'B006', vaccineType: 'Vaccine X', vaccinationDate: d(-2) }), A); const vx = r.body.data.id;
  r = await post(V, vb({ cattleCode: 'B006', vaccineType: 'vaccine y', vaccinationDate: d(-2) }), A); t('2 vaccine chống chỉ định cùng ngày -> 409 VACCINE_CONTRAINDICATED', r.status === 409 && r.body.error.code === 'VACCINE_CONTRAINDICATED');
  r = await post(V, vb({ cattleCode: 'B006', vaccineType: 'Vaccine Y', vaccinationDate: d(-1) }), A); const vy = r.body.data.id; t('khác ngày -> được', r.status === 201);
  r = await patch(`${V}/${vy}`, { vaccinationDate: d(-2) }, A); t('sửa ngày về trùng ngày chống chỉ định -> 409', r.status === 409 && r.body.error.code === 'VACCINE_CONTRAINDICATED');
  r = await post(V, vb({ cattleCode: 'B005', vaccineType: 'Vaccine Y', vaccinationDate: d(-2) }), A); t('bò khác cùng ngày -> được', r.status === 201);
  VACCINE_CONTRAINDICATIONS.length = 0;

  r = await get(V + '/export?format=csv&status=OVERDUE', A); csv = r.buf?.toString('utf8') || '';
  t('export tiêm phòng csv: tiêu đề + trạng thái tiếng Việt', r.status === 200 && csv.includes('Loại vaccine') && csv.includes('Quá hạn') && !csv.includes('Sắp đến hạn'));
  r = await get(V + '/export?scope=all', A); t('export scope=all xlsx + audit EXPORT', r.status === 200 && auditOf('EXPORT', 'health').some((a) => a.entity === 'Vaccination'));
  t('referenceGuard: bò có lịch sử tiêm phòng', (await referenceGuard.referencesOf('Cattle', [String(cattle('B004')._id)]))[String(cattle('B004')._id)]?.some((x) => x.label === 'lịch sử tiêm phòng'));

  // ================= CÁCH LY =================
  const qb = (o) => ({ cattleCode: 'B003', disease: 'Lở mồm long móng', startDate: d(-1), ...o });
  r = await post(Q, {}, A); t('tạo thiếu dữ liệu -> 422', r.status === 422 && ['cattleCode', 'disease', 'startDate'].every((f) => r.body.error.details.some((x) => x.field === `body.${f}`)));
  r = await post(Q, qb(), A); t('bò Đang nuôi (chưa điều trị) -> 409 CATTLE_NOT_TREATING', r.status === 409 && r.body.error.code === 'CATTLE_NOT_TREATING');
  await post(H, { cattleCode: 'B003', examDate: d(-1), diagnosis: 'Nghi LMLM', performedBy: 'BS Lan', conclusion: 'SICK' }, A);
  t('(chuẩn bị) bò B003 đang điều trị', cattle('B003').status === 'TREATING');
  r = await post(Q, qb({ startDate: d(1) }), A); t('ngày cách ly tương lai -> 422', r.status === 422);
  r = await post(Q, qb({ expectedRecoveryDate: d(-5) }), A); t('ngày dự kiến khỏi < ngày cách ly -> 422', r.status === 422 && r.body.error.details[0].field === 'body.expectedRecoveryDate');
  r = await post(Q, qb({ startDate: d(-900) }), A); t('ngày cách ly trước ngày nhập đàn -> 422', r.status === 422 && r.body.error.details[0].field === 'body.startDate');
  r = await post(Q, qb({ expectedRecoveryDate: d(14), note: 'Tách riêng khu C' }), A); const q1 = r.body.data.id;
  t('cách ly -> 201, bò sang Đang cách ly, đợt ACTIVE', r.status === 201 && r.body.data.status === 'ACTIVE' && r.body.data.cattleStatus === 'QUARANTINED' && cattle('B003').status === 'QUARANTINED');
  t('lịch sử trạng thái bò + audit', fake.CattleStatusHistory.rows.some((x) => x.to === 'QUARANTINED' && String(x.cattleId) === String(cattle('B003')._id)) && auditOf('CREATE', 'health').some((a) => a.entity === 'Quarantine'));
  r = await post(Q, qb(), A); t('bò đã cách ly, tạo tiếp -> 409', r.status === 409 && r.body.error.code === 'CATTLE_NOT_TREATING');
  let blocked = false; try { assertNotQuarantined(cattle('B003')); } catch (e) { blocked = e.code === 'CATTLE_QUARANTINED'; }
  t('assertNotQuarantined chặn ghi sản lượng cho bò đang cách ly', blocked);
  r = await post(`${Q}/${q1}/notes`, { note: '  Hạ sốt, ăn lại ' }, A); t('thêm diễn biến -> 200, lưu người ghi + thời điểm', r.status === 200 && r.body.data.progress.length === 1 && r.body.data.progress[0].note === 'Hạ sốt, ăn lại');
  r = await post(`${Q}/${q1}/notes`, { note: ' ' }, A); t('diễn biến rỗng -> 422', r.status === 422);
  r = await get(`${Q}/${q1}`, A); t('chi tiết: ghi chú, diễn biến, số ngày cách ly', r.status === 200 && r.body.data.note === 'Tách riêng khu C' && r.body.data.daysInQuarantine === 1);
  r = await get(Q + '?status=ACTIVE', A); t('list lọc Đang cách ly', r.body.data.total === 1);
  r = await get(Q + '?q=lo%20mom', A); t('tìm theo bệnh không dấu', r.body.data.total === 1);
  r = await post(`${Q}/${q1}/end`, { endDate: d(-5) }, A); t('kết thúc trước ngày cách ly -> 422', r.status === 422 && r.body.error.details[0].field === 'body.endDate');
  r = await post(`${Q}/${q1}/end`, { outcome: 'XYZ' }, A); t('kết quả lạ -> 422', r.status === 422);
  r = await post(`${Q}/${q1}/end`, { note: 'Đã khỏi hoàn toàn' }, A); t('kết thúc (mặc định Đã khỏi) -> bò về Đang nuôi', r.status === 200 && r.body.data.status === 'ENDED' && r.body.data.outcome === 'RECOVERED' && r.body.data.cattleStatus === 'RAISING' && cattle('B003').status === 'RAISING');
  r = await post(`${Q}/${q1}/end`, {}, A); t('kết thúc lần 2 -> 409 QUARANTINE_ALREADY_ENDED', r.status === 409 && r.body.error.code === 'QUARANTINE_ALREADY_ENDED');
  r = await post(`${Q}/${q1}/notes`, { note: 'x' }, A); t('thêm diễn biến sau khi kết thúc -> 409', r.status === 409);
  r = await get(`${Q}/000000000000000000000000`, A); t('chi tiết không tồn tại -> 404', r.status === 404);
  // đợt 2: chưa khỏi -> quay lại điều trị
  await post(H, { cattleCode: 'B003', examDate: d(0), diagnosis: 'Tái phát', performedBy: 'BS Lan', conclusion: 'SICK' }, A);
  r = await post(Q, qb({ startDate: d(0) }), A); const q2 = r.body.data.id;
  r = await post(`${Q}/${q2}/end`, { outcome: 'CONTINUE_TREATMENT' }, A); t('kết thúc "tiếp tục điều trị" -> bò về Đang điều trị', r.status === 200 && cattle('B003').status === 'TREATING');
  r = await get(Q + '?status=ENDED&cattleCode=b003', A); t('lịch sử cách ly của 1 bò: 2 đợt đã kết thúc', r.body.data.total === 2);
  t('referenceGuard: bò có lịch sử cách ly', (await referenceGuard.referencesOf('Cattle', [String(cattle('B003')._id)]))[String(cattle('B003')._id)]?.some((x) => x.label === 'lịch sử cách ly'));
  // ================= TÍCH HỢP CHI TIẾT BÒ =================
  r = await get(`/admin/farm/cattle/${cattle('B003')._id}`, A);
  t('chi tiết bò: healthRecords (4 hồ sơ, mới nhất trước), vaccinations rỗng', r.status === 200 && r.body.data.healthRecords.length === 4 && r.body.data.healthRecords[0].diagnosis === 'Tái phát' && r.body.data.vaccinations.length === 0);
  r = await get(`/admin/farm/cattle/${cattle('B005')._id}`, A);
  t('chi tiết bò: vaccinations (3 bản ghi, có trạng thái), healthRecords rỗng', r.status === 200 && r.body.data.vaccinations.length === 3 && r.body.data.vaccinations.every((x) => x.status) && r.body.data.healthRecords.length === 0);
  h.close(); origLog(`\n${h.passed()} kiểm tra đạt`); process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });