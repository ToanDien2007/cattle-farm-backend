'use strict';
// Chạy: node tests/manual/verifyFarm.js  (không cần MongoDB, xem helpers/harness.js)
const ExcelJS = require('exceljs');
const { start } = require('./helpers/harness');

(async () => {
  const h = await start();
  const { t, post, get, patch, del, put, call, upload, fake, req, origLog } = h;
  const { todayYmdVN, shiftMonthsVN, ymdOf } = req('src/utils/datetime.js');
  const referenceGuard = req('src/shared/referenceGuard.js');
  const { assertOperable } = req('src/modules/farm/cattle/cattleStatus.service.js');

  const mk = async (data, pw = 'Abcdef12') => fake.User.create({ passwordHash: await h.hash(pw), ...data });
  await mk({ fullName: 'Admin', email: 'root@farm.vn', role: 'ADMIN' });
  await mk({ fullName: 'Admin 2', email: 'root2@farm.vn', role: 'ADMIN' });
  await mk({ fullName: 'Khach', email: 'k@farm.vn', role: 'CUSTOMER' });
  const login = async (id) => (await post('/auth/login', { identifier: id, password: 'Abcdef12' })).body.data.accessToken;
  const A = await login('root@farm.vn'), A2 = await login('root2@farm.vn'), K = await login('k@farm.vn');
  const auditOf = (action, module) => fake.AuditLog.rows.filter((a) => a.action === action && (!module || a.module === module));
  const today = todayYmdVN();
  const ago = (months) => ymdOf(shiftMonthsVN(today, -months));
  let r;

  const B = '/admin/farm/breeds', P = '/admin/farm/pens', C = '/admin/farm/cattle';
  r = await get(B, K); t('khách hàng không vào được /admin/farm -> 403', r.status === 403);
  r = await get(C); t('không token -> 401', r.status === 401);

  // ================= BREEDS =================
  r = await post(B, { description: 'x' }, A); t('tạo giống thiếu tên -> 422', r.status === 422 && r.body.error.details.some((d) => d.field === 'body.name'));
  r = await post(B, { name: 'Brahman', description: 'Chịu nóng', characteristics: 'Có u vai' }, A); t('tạo giống -> 201, mặc định Đang dùng, 0 bò', r.status === 201 && r.body.data.status === 'ACTIVE' && r.body.data.cattleCount === 0);
  const brahmanId = r.body.data.id;
  r = await post(B, { name: '  brahman ' }, A); t('trùng tên không phân biệt hoa/thường -> 409', r.status === 409 && r.body.error.code === 'BREED_NAME_TAKEN');
  const angusId = (await post(B, { name: 'Angus' }, A)).body.data.id;
  const sua = (await post(B, { name: 'Bò Sữa Hà Lan' }, A)).body.data.id;
  const wagyuId = (await post(B, { name: 'Wagyu' }, A)).body.data.id;
  r = await get(B, A); t('list: sắp xếp theo tên tăng dần, có cột số bò + trạng thái', r.body.data.total === 4 && r.body.data.items[0].name === 'Angus' && 'cattleCount' in r.body.data.items[0]);
  r = await get(B + '?q=bo%20sua', A); t('tìm giống bỏ dấu "bo sua"', r.body.data.total === 1 && r.body.data.items[0].name === 'Bò Sữa Hà Lan');
  r = await patch(`${B}/${brahmanId}`, { name: 'Brahman Đỏ', description: 'mới' }, A); t('sửa tên giống -> 200', r.status === 200 && r.body.data.name === 'Brahman Đỏ');
  r = await get(B + '?q=brahman do', A); t('tìm theo tên MỚI được', r.body.data.total === 1);
  r = await patch(`${B}/${brahmanId}`, { name: 'angus' }, A); t('đổi sang tên đã có -> 409', r.status === 409);
  r = await patch(`${B}/${brahmanId}`, { name: '' }, A); t('sửa tên rỗng -> 422', r.status === 422);

  // ================= PENS =================
  r = await post(P, { code: 'c01', name: 'Chuồng 1', capacity: 3, zone: 'A' }, A); t('tạo chuồng -> 201, mã viết hoa, 0/3', r.status === 201 && r.body.data.code === 'C01' && r.body.data.currentCount === 0 && r.body.data.fillStatus === 'AVAILABLE');
  const p1 = r.body.data.id;
  r = await post(P, { code: 'C01', name: 'Trùng', capacity: 5, zone: 'A' }, A); t('trùng mã chuồng -> 409', r.status === 409 && r.body.error.code === 'PEN_CODE_TAKEN');
  r = await post(P, { code: 'X', name: 'X', capacity: 0, zone: 'A' }, A); t('sức chứa 0 -> 422', r.status === 422);
  r = await post(P, { code: 'X', name: 'X', capacity: '2.5', zone: 'A' }, A); t('sức chứa không nguyên -> 422', r.status === 422);
  const p2 = (await post(P, { code: 'C02', name: 'Chuồng bê', capacity: 10, zone: 'B', type: 'Chuồng bê' }, A)).body.data.id;
  const p3 = (await post(P, { code: 'C03', name: 'Chuồng cách ly', capacity: 2, zone: 'A' }, A)).body.data.id;

  // ================= CATTLE: tạo =================
  const body = (o = {}) => ({ code: 'B001', earTag: 'TAG-001', name: 'Bê Vàng', breedId: brahmanId, sex: 'FEMALE', birthDate: ago(24), weightKg: 350.456, penId: p1, origin: 'BORN', joinDate: ago(20), ...o });
  r = await post(C, {}, A); t('tạo bò thiếu dữ liệu -> 422 báo từng trường', r.status === 422 && ['code', 'earTag', 'breedId', 'sex', 'birthDate', 'weightKg', 'penId', 'joinDate'].every((f) => r.body.error.details.some((d) => d.field === `body.${f}`)));
  r = await post(C, body({ weightKg: 'abc' }), A); t('trọng lượng không phải số -> 422', r.status === 422 && r.body.error.details[0].field === 'body.weightKg');
  r = await post(C, body({ weightKg: -5 }), A); t('trọng lượng âm -> 422', r.status === 422);
  r = await post(C, body({ birthDate: '2999-01-01' }), A); t('ngày sinh ở tương lai -> 422', r.status === 422 && r.body.error.details[0].message.includes('lớn hơn ngày hiện tại'));
  r = await post(C, body({ birthDate: ago(2), joinDate: ago(5) }), A); t('ngày nhập đàn < ngày sinh -> 422', r.status === 422 && r.body.error.details[0].field === 'body.joinDate');
  r = await post(C, body({ birthDate: '2026-02-31' }), A); t('ngày không tồn tại (31/02) -> 422', r.status === 422 && r.body.error.details[0].field === 'body.birthDate');
  r = await post(C, body({ sex: 'KHAC' }), A); t('giới tính lạ -> 422', r.status === 422);
  r = await post(C, body({ breedId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), A); t('giống không tồn tại -> 422 BREED_NOT_FOUND', r.status === 422 && r.body.error.code === 'BREED_NOT_FOUND');
  r = await post(C, body({ penId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), A); t('chuồng không tồn tại -> 422 PEN_NOT_FOUND', r.status === 422 && r.body.error.code === 'PEN_NOT_FOUND');
  t('các lần tạo lỗi không để lại bò nào', fake.Cattle.rows.length === 0);

  r = await post(C, body({ code: ' b001 ' }), A);
  t('tạo bò -> 201: mã viết hoa, trọng lượng làm tròn 2 số, mặc định Đang nuôi, tuổi 24 tháng', r.status === 201 && r.body.data.code === 'B001' && r.body.data.weightKg === 350.46 && r.body.data.status === 'RAISING' && r.body.data.ageMonths === 24 && r.body.data.breed.name === 'Brahman Đỏ' && r.body.data.pen.code === 'C01');
  const b1 = r.body.data.id;
  t('ghi lịch sử nhập chuồng + audit CREATE', fake.PenAssignment.rows.length === 1 && fake.PenAssignment.rows[0].fromPenId == null && auditOf('CREATE', 'cattle').length === 1);
  r = await post(C, body({ earTag: 'tag-002' }), A); t('trùng mã bò (khác hoa/thường) -> 409 CATTLE_CODE_TAKEN', r.status === 409 && r.body.error.code === 'CATTLE_CODE_TAKEN');
  r = await post(C, body({ code: 'B002' }), A); t('trùng số tai/RFID -> 409 EAR_TAG_TAKEN', r.status === 409 && r.body.error.code === 'EAR_TAG_TAKEN');

  // sức chứa: C01 có sức chứa 3
  r = await post(C, body({ code: 'B002', earTag: 'TAG-002', name: 'Đen', sex: 'MALE', birthDate: ago(6), weightKg: 180, joinDate: ago(5) }), A);
  t('bò thứ 2 vào chuồng 3 chỗ -> không cảnh báo', r.status === 201 && r.body.data.warnings.length === 0);
  const b2 = r.body.data.id;
  r = await post(C, body({ code: 'B003', earTag: 'TAG-003', name: 'Nâu', sex: 'MALE', birthDate: ago(5), weightKg: 150, joinDate: ago(4) }), A);
  t('bò thứ 3 làm chuồng đạt ≥90% -> 201 kèm cảnh báo PEN_NEARLY_FULL', r.status === 201 && r.body.data.warnings[0]?.code === 'PEN_NEARLY_FULL');
  const b3 = r.body.data.id;
  r = await post(C, body({ code: 'B004', earTag: 'TAG-004' }), A); t('chuồng đầy -> 409 PEN_FULL, không tạo bò', r.status === 409 && r.body.error.code === 'PEN_FULL' && !fake.Cattle.rows.find((c) => c.code === 'B004'));
  r = await get(`${P}/${p1}`, A); t('chi tiết chuồng: 3/3, Đầy, liệt kê bò', r.body.data.currentCount === 3 && r.body.data.fillStatus === 'FULL' && r.body.data.fillPercent === 100 && r.body.data.cattle.length === 3);

  // ================= PENS: list/sửa/xóa =================
  r = await get(P, A); t('list chuồng: 3 chuồng, kèm số bò + % + tình trạng', r.body.data.total === 3 && r.body.data.items[0].code === 'C01' && r.body.data.items[0].currentCount === 3);
  r = await get(P + '?fill=FULL', A); t('lọc chuồng Đầy', r.body.data.total === 1 && r.body.data.items[0].code === 'C01');
  r = await get(P + '?fill=AVAILABLE&sortBy=capacity&order=desc', A); t('lọc Còn chỗ, sắp xếp sức chứa giảm dần', r.body.data.items.map((i) => i.code).join() === 'C02,C03');
  r = await get(P + '?sortBy=fillPercent&order=desc', A); t('sắp xếp % lấp đầy giảm dần', r.body.data.items[0].code === 'C01');
  r = await get(P + '?zone=A', A); t('lọc khu vực A', r.body.data.total === 2);
  r = await get(P + '?q=cach%20ly', A); t('tìm chuồng bỏ dấu theo tên', r.body.data.total === 1 && r.body.data.items[0].code === 'C03');
  r = await patch(`${P}/${p1}`, { capacity: 2 }, A); t('giảm sức chứa dưới số bò hiện có -> 409', r.status === 409 && r.body.error.code === 'CAPACITY_BELOW_OCCUPANCY');
  r = await patch(`${P}/${p1}`, { capacity: 4, type: 'Chuồng nuôi thịt' }, A); t('tăng sức chứa -> 200, 75%', r.status === 200 && r.body.data.capacity === 4 && r.body.data.fillPercent === 75 && r.body.data.fillStatus === 'AVAILABLE');
  r = await patch(`${P}/${p1}`, { capacity: 3 }, A); t('hạ về 3 (= số bò) -> OK', r.status === 200);
  r = await del(`${P}/${p1}`, A); t('xóa chuồng còn bò -> 409 PEN_NOT_EMPTY', r.status === 409 && r.body.error.code === 'PEN_NOT_EMPTY');

  // ================= CATTLE: danh sách/lọc/tìm =================
  const b4 = (await post(C, body({ code: 'B010', earTag: 'TAG-010', name: 'Hồng Phúc', breedId: angusId, sex: 'FEMALE', birthDate: ago(48), weightKg: 500, penId: p2, joinDate: ago(40) }), A)).body.data.id;
  r = await get(C, A);
  t('list: 4 bò, mặc định sắp theo mã tăng dần, đủ cột (giống, chuồng, tuổi, trọng lượng...)', r.body.data.total === 4 && r.body.data.items.map((i) => i.code).join() === 'B001,B002,B003,B010' && r.body.data.items.every((i) => i.breed && i.pen && 'ageMonths' in i && 'weightKg' in i && 'image' in i));
  t('list không lộ searchText', !JSON.stringify(r.body).includes('searchText'));
  r = await get(C + '?sortBy=weightKg&order=desc', A); t('sắp xếp trọng lượng giảm dần', r.body.data.items[0].code === 'B010');
  r = await get(C + '?limit=10&page=2', A); t('trang vượt quá -> rỗng, total giữ nguyên', r.body.data.items.length === 0 && r.body.data.total === 4);
  r = await get(C + '?limit=7', A); t('limit sai -> 422', r.status === 422);
  r = await get(C + '?q=hong phuc', A); t('tìm theo tên bỏ dấu', r.body.data.total === 1 && r.body.data.items[0].code === 'B010');
  r = await get(C + '?q=tag-003', A); t('tìm theo số tai/RFID', r.body.data.items[0]?.code === 'B003');
  r = await get(C + '?q=b00', A); t('tìm theo mã (contains)', r.body.data.total === 3);
  r = await get(C + `?breedId=${angusId}`, A); t('lọc giống', r.body.data.total === 1);
  r = await get(C + `?breedId=${angusId},${brahmanId}&sex=MALE`, A); t('lọc nhiều giống + giới tính (AND)', r.body.data.total === 2);
  r = await get(C + `?penId=${p2}`, A); t('lọc chuồng', r.body.data.total === 1);
  r = await get(C + '?ageMonthsMin=24', A); t('lọc tuổi ≥ 24 tháng (đúng 24 tháng được tính)', r.body.data.items.map((i) => i.code).join() === 'B001,B010');
  r = await get(C + '?ageMonthsMax=5', A); t('lọc tuổi ≤ 5 tháng', r.body.data.items.map((i) => i.code).join() === 'B003');
  r = await get(C + '?ageMonthsMin=6&ageMonthsMax=6', A); t('lọc đúng 6 tháng tuổi', r.body.data.items.map((i) => i.code).join() === 'B002');
  r = await get(C + '?ageMonthsMin=10&ageMonthsMax=5', A); t('tuổi min > max -> 422', r.status === 422);
  r = await get(C + '?weightMin=170&weightMax=400', A); t('lọc trọng lượng 170-400kg', r.body.data.items.map((i) => i.code).join() === 'B001,B002');
  r = await get(C + `?joinedFrom=${ago(5)}&joinedTo=${ago(4)}`, A); t('lọc khoảng ngày nhập đàn', r.body.data.items.map((i) => i.code).join() === 'B002,B003');
  r = await get(C + '?status=SOLD', A); t('lọc trạng thái không có -> rỗng', r.body.data.total === 0);
  r = await get(C + '?sortBy=hack', A); t('sortBy lạ -> 422', r.status === 422);

  // ================= CATTLE: chi tiết/sửa =================
  r = await get(`${C}/${b1}`, A);
  t('chi tiết: thông tin + phả hệ trống + lịch sử chuồng + lịch sử thay đổi + chỗ chờ module sức khỏe/sản lượng', r.status === 200 && r.body.data.pedigree.sire === null && r.body.data.penHistory.length === 1 && r.body.data.penHistory[0].to === 'C01' && r.body.data.history.length === 1 && Array.isArray(r.body.data.healthRecords));
  r = await get(`${C}/aaaaaaaaaaaaaaaaaaaaaaaa`, A); t('chi tiết không tồn tại -> 404', r.status === 404 && r.body.error.code === 'CATTLE_NOT_FOUND');
  r = await get(`${C}/xyz`, A); t('id sai định dạng -> 422', r.status === 422);

  r = await patch(`${C}/${b1}`, { code: 'B999' }, A); t('sửa Mã bò -> 422 CODE_IMMUTABLE', r.status === 422 && r.body.error.code === 'CODE_IMMUTABLE');
  r = await patch(`${C}/${b1}`, { code: 'b001', name: 'Vàng Con', weightKg: '360,5' }, A); t('gửi lại đúng mã + sửa tên/trọng lượng (dấu phẩy) -> 200', r.status === 200 && r.body.data.name === 'Vàng Con' && r.body.data.weightKg === 360.5);
  r = await get(C + '?q=vang con', A); t('tìm theo tên MỚI được (searchText cập nhật)', r.body.data.total === 1);
  r = await patch(`${C}/${b1}`, { earTag: 'TAG-002' }, A); t('sửa trùng số tai -> 409', r.status === 409 && r.body.error.code === 'EAR_TAG_TAKEN');
  r = await patch(`${C}/${b1}`, {}, A); t('sửa body rỗng -> 422', r.status === 422);
  r = await patch(`${C}/${b1}`, { joinDate: ago(30) }, A); t('sửa ngày nhập đàn < ngày sinh -> 422', r.status === 422 && r.body.error.details[0].field === 'body.joinDate');
  const before = auditOf('UPDATE', 'cattle').length;
  r = await patch(`${C}/${b1}`, { note: 'Ghi chú' }, A); t('audit UPDATE ghi trước/sau', auditOf('UPDATE', 'cattle').length === before + 1 && auditOf('UPDATE', 'cattle').at(-1).before.note === undefined && auditOf('UPDATE', 'cattle').at(-1).after.note === 'Ghi chú');
  r = await patch(`${C}/${b1}`, { note: '' }, A); t('note rỗng = xóa ghi chú', r.body.data.note === null);

  // chuyển chuồng
  r = await patch(`${C}/${b1}`, { penId: p2 }, A); t('sửa chuồng qua PATCH -> chuyển chuồng, ghi lịch sử', r.status === 200 && r.body.data.pen.code === 'C02' && fake.PenAssignment.rows.length === 5 && fake.PenAssignment.rows.at(-1).fromPenId.toString() === p1);
  r = await post(`${C}/${b1}/move-pen`, { penId: p2 }, A); t('chuyển vào chính chuồng đang ở -> 409 SAME_PEN', r.status === 409 && r.body.error.code === 'SAME_PEN');
  r = await post(`${C}/${b1}/move-pen`, { penId: p1, note: 'Đưa về' }, A); t('chuyển về C01 (còn 1 chỗ) -> 200', r.status === 200 && r.body.data.pen.code === 'C01');
  r = await post(`${C}/${b4}/move-pen`, { penId: p1 }, A); t('chuyển vào chuồng đầy -> 409 PEN_FULL, bò giữ nguyên chuồng', r.status === 409 && r.body.error.code === 'PEN_FULL' && (await get(`${C}/${b4}`, A)).body.data.pen.code === 'C02');
  r = await post(`${C}/${b4}/move-pen`, { penId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, A); t('chuyển sang chuồng không tồn tại -> 422', r.status === 422 && r.body.error.code === 'PEN_NOT_FOUND');
  t('audit MOVE', auditOf('MOVE', 'cattle').length === 1);

  // đổi sang giống đã ẩn
  const hiddenBreed = (await post(B, { name: 'Giống Ẩn' }, A)).body.data.id;
  await del(`${B}/${hiddenBreed}`, A);
  r = await patch(`${C}/${b1}`, { breedId: hiddenBreed }, A); t('đổi sang giống đã ẩn -> 422', r.status === 422 && r.body.error.code === 'BREED_NOT_FOUND');
  r = await post(C, body({ code: 'B777', earTag: 'T777', breedId: hiddenBreed, penId: p2 }), A); t('thêm bò thuộc giống đã ẩn -> 422', r.status === 422);

  // ================= BREEDS: xóa/khôi phục (sau khi đã có bò) =================
  r = await del(`${B}/${brahmanId}`, A); t('xóa giống đang có bò -> 409 BREED_IN_USE, báo số bò', r.status === 409 && r.body.error.code === 'BREED_IN_USE' && r.body.error.message.includes('3 bò'));
  r = await get(`${B}/${brahmanId}`, A); t('giống có 3 bò trong đàn', r.body.data.cattleCount === 3);
  r = await del(`${B}/${wagyuId}`, A); t('xóa giống không có bò -> ẩn (HIDDEN)', r.status === 200 && r.body.data.deleted[0].mode === 'HIDDEN');
  r = await get(B + '?status=HIDDEN', A); t('lọc Đã ẩn thấy giống đã xóa', r.body.data.items.map((i) => i.name).sort().join() === 'Giống Ẩn,Wagyu');
  r = await get(B + '?status=ACTIVE', A); t('lọc Đang dùng không thấy giống ẩn', r.body.data.items.every((i) => i.status === 'ACTIVE'));
  r = await post(B, { name: 'wagyu' }, A); t('tạo lại tên giống đã ẩn -> 409 kèm gợi ý khôi phục', r.status === 409 && r.body.error.message.includes('khôi phục'));
  r = await patch(`${B}/${wagyuId}`, { name: 'Wagyu 2' }, A); t('sửa giống đã ẩn -> 409', r.status === 409);
  r = await post(`${B}/${wagyuId}/restore`, null, A); t('khôi phục giống -> ACTIVE', r.status === 200 && r.body.data.status === 'ACTIVE');
  r = await post(`${B}/${wagyuId}/restore`, null, A); t('khôi phục giống đang dùng -> 409', r.status === 409 && r.body.error.code === 'NOT_HIDDEN');
  r = await post(`${B}/bulk-delete`, { ids: [String(wagyuId), String(brahmanId), 'cccccccccccccccccccccccc'] }, A);
  t('xóa hàng loạt: trả kết quả từng giống (xóa được / không xóa được + lý do)', r.status === 200 && r.body.data.deleted.length === 1 && r.body.data.failed.map((f) => f.code).sort().join() === 'BREED_IN_USE,BREED_NOT_FOUND');
  r = await del(`${B}/${wagyuId}`, A); t('xóa giống đã ẩn -> 409 ALREADY_HIDDEN', r.status === 409 && r.body.error.code === 'ALREADY_HIDDEN');
  r = await post(`${B}/bulk-delete`, { ids: [] }, A); t('bulk-delete rỗng -> 422', r.status === 422);

  // ================= PHẢ HỆ =================
  const mkCow = async (o) => (await post(C, body({ penId: p2, ...o }), A)).body.data;
  const G = await mkCow({ code: 'G001', earTag: 'TG1', sex: 'MALE', birthDate: ago(100), joinDate: ago(90) });
  const F = await mkCow({ code: 'F001', earTag: 'TF1', sex: 'MALE', birthDate: ago(70), joinDate: ago(60) });
  const M = await mkCow({ code: 'M001', earTag: 'TM1', sex: 'FEMALE', birthDate: ago(70), joinDate: ago(60) });
  const K1 = await mkCow({ code: 'K001', earTag: 'TK1', sex: 'FEMALE', birthDate: ago(40), joinDate: ago(30) });
  r = await put(`${C}/${F.id}/pedigree`, { sireCode: 'g001' }, A); t('gán bố bằng mã (không phân biệt hoa/thường) -> 200', r.status === 200 && r.body.data.sire.code === 'G001');
  r = await put(`${C}/${M.id}/pedigree`, { sireCode: 'G001' }, A);
  r = await put(`${C}/${K1.id}/pedigree`, { sireCode: 'F001', damCode: 'M001' }, A);
  t('gán cả bố và mẹ -> có cảnh báo cận huyết (bố mẹ cùng cha G001)', r.status === 200 && r.body.data.sire.code === 'F001' && r.body.data.dam.code === 'M001' && r.body.data.warnings[0]?.code === 'INBREEDING_RISK' && r.body.data.warnings[0].message.includes('G001'));
  r = await put(`${C}/${K1.id}/pedigree`, { sireCode: 'NOPE' }, A); t('mã bố không tồn tại -> 422 PARENT_NOT_FOUND', r.status === 422 && r.body.error.code === 'PARENT_NOT_FOUND');
  r = await put(`${C}/${K1.id}/pedigree`, { sireCode: 'M001' }, A); t('bố là bò cái -> 422 PARENT_SEX_MISMATCH', r.status === 422 && r.body.error.code === 'PARENT_SEX_MISMATCH');
  r = await put(`${C}/${K1.id}/pedigree`, { damCode: 'K001' }, A); t('chọn chính mình làm mẹ -> 422', r.status === 422 && ['PEDIGREE_SELF', 'PARENT_SEX_MISMATCH'].includes(r.body.error.code));
  r = await put(`${C}/${G.id}/pedigree`, { sireCode: 'F001' }, A); t('tạo vòng lặp phả hệ (ông làm con của cháu) -> 422 PEDIGREE_LOOP', r.status === 422 && r.body.error.code === 'PEDIGREE_LOOP');
  r = await put(`${C}/${G.id}/pedigree`, { sireCode: 'K001' }, A); t('vòng lặp 2 đời cũng bị chặn (K001 là cái nên chặn bằng giới tính trước)', r.status === 422);
  r = await put(`${C}/${G.id}/pedigree`, {}, A); t('thiếu cả sireCode lẫn damCode -> 422', r.status === 422);
  r = await get(`${C}/${K1.id}/pedigree?depth=2`, A); t('cây phả hệ 2 đời: K001 <- F001,M001 <- G001', r.body.data.tree.sire.code === 'F001' && r.body.data.tree.sire.sire.code === 'G001' && r.body.data.tree.dam.sire.code === 'G001' && r.body.data.tree.sire.sire.sire === null);
  r = await get(`${C}/${K1.id}/pedigree?depth=1`, A); t('depth=1 chỉ lấy bố/mẹ', r.body.data.tree.sire.code === 'F001' && r.body.data.tree.sire.sire === null);
  r = await get(`${C}/${G.id}/pedigree`, A); t('danh sách con trực tiếp của G001 = F001, M001', r.body.data.children.map((x) => x.code).sort().join() === 'F001,M001');
  r = await get(`${C}/${K1.id}`, A); t('chi tiết hiển thị Bố/Mẹ', r.body.data.pedigree.sire.code === 'F001' && r.body.data.pedigree.dam.code === 'M001');
  r = await put(`${C}/${K1.id}/pedigree`, { sireCode: null, damCode: '' }, A); t('bỏ liên kết bố/mẹ bằng null/""', r.status === 200 && r.body.data.sire === null && r.body.data.dam === null);
  await put(`${C}/${K1.id}/pedigree`, { sireCode: 'F001', damCode: 'M001' }, A);
  t('audit PEDIGREE', auditOf('PEDIGREE', 'cattle').length >= 5);

  // ================= CHUYỂN TRẠNG THÁI =================
  const S = (o) => ({ newStatus: 'SOLD', effectiveDate: today, ...o });
  r = await post(`${C}/${b2}/status`, S({ newStatus: 'RAISING' }), A); t('trạng thái đích không hợp lệ -> 422', r.status === 422);
  r = await post(`${C}/${b2}/status`, S({ newStatus: 'REMOVED' }), A); t('REMOVED thiếu removalType -> 422', r.status === 422 && r.body.error.details[0].field === 'body.removalType');
  r = await post(`${C}/${b2}/status`, S({ newStatus: 'DEAD' }), A); t('Đã chết thiếu lý do -> 422', r.status === 422 && r.body.error.details[0].field === 'body.reason');
  r = await post(`${C}/${b2}/status`, S({ newStatus: 'REMOVED', removalType: 'CULLED' }), A); t('Loại thải thiếu lý do -> 422', r.status === 422);
  r = await post(`${C}/${b2}/status`, S({ removalType: 'CULLED' }), A); t('removalType với SOLD -> 422', r.status === 422);
  r = await post(`${C}/${b2}/status`, S({ effectiveDate: '2999-01-01' }), A); t('ngày chuyển ở tương lai -> 422', r.status === 422);
  r = await post(`${C}/${b2}/status`, S({ effectiveDate: ago(40) }), A); t('ngày chuyển < ngày nhập đàn -> 422', r.status === 422 && r.body.error.details[0].field === 'body.effectiveDate');
  const occBefore = (await get(`${P}/${p1}`, A)).body.data.currentCount;
  r = await post(`${C}/${b2}/status`, S({ note: 'Bán cho trại X' }), A);
  t('chuyển sang Đã bán -> 200', r.status === 200 && r.body.data.status === 'SOLD');
  t('lưu lịch sử trạng thái (từ -> đến, ngày, người thực hiện)', fake.CattleStatusHistory.rows.length === 1 && fake.CattleStatusHistory.rows[0].from === 'RAISING' && fake.CattleStatusHistory.rows[0].to === 'SOLD' && !!fake.CattleStatusHistory.rows[0].changedBy);
  t('bò đã bán giải phóng chỗ trong chuồng', (await get(`${P}/${p1}`, A)).body.data.currentCount === occBefore - 1);
  r = await get(C + '?status=SOLD', A); t('lọc theo trạng thái Đã bán', r.body.data.total === 1 && r.body.data.items[0].code === 'B002');
  r = await get(B + `/${brahmanId}`, A); t('số bò của giống không tính bò đã bán', r.body.data.cattleCount === 2 + 0 + (await get(C + `?breedId=${brahmanId}&status=RAISING`, A)).body.data.total - 2);
  r = await post(`${C}/${b2}/status`, S({ newStatus: 'DEAD', reason: 'x' }), A); t('chuyển tiếp từ Đã bán -> 409 INVALID_STATUS_TRANSITION', r.status === 409 && r.body.error.code === 'INVALID_STATUS_TRANSITION');
  r = await post(`${C}/${b2}/move-pen`, { penId: p2 }, A); t('bò đã bán không chuyển chuồng được -> 409 CATTLE_NOT_OPERABLE', r.status === 409 && r.body.error.code === 'CATTLE_NOT_OPERABLE');
  let e1; try { assertOperable(fake.Cattle.rows.find((c) => c.code === 'B002')); } catch (e) { e1 = e; }
  t('assertOperable() chặn nghiệp vụ mới với bò đã bán (dành cho module khác)', e1?.code === 'CATTLE_NOT_OPERABLE');
  r = await post(`${C}/${b3}/status`, { newStatus: 'REMOVED', removalType: 'CULLED', reason: 'Bệnh mạn tính', effectiveDate: today }, A);
  t('Loại thải -> trạng thái Không còn trong đàn, ghi loại + lý do', r.status === 200 && r.body.data.status === 'REMOVED' && r.body.data.exit.removalType === 'CULLED' && r.body.data.exit.reason === 'Bệnh mạn tính');
  r = await patch(`${C}/${b3}`, { name: 'x' }, A); t('sửa bò đã Không còn trong đàn -> 409', r.status === 409);
  r = await get(`${C}/${b3}`, A); t('chi tiết vẫn xem được, có lịch sử trạng thái', r.status === 200 && r.body.data.statusHistory.length === 1);
  r = await post(C, body({ code: 'B011', earTag: 'T011' }), A); t('chuồng C01 đã có chỗ trống sau khi bán/loại thải -> tạo được bò mới', r.status === 201);
  t('audit STATUS_CHANGE', auditOf('STATUS_CHANGE', 'cattle').length === 2);

  // ================= XÓA BÒ =================
  const fresh = await mkCow({ code: 'N001', earTag: 'TN1' });
  const withData = await mkCow({ code: 'D001', earTag: 'TD1' });
  referenceGuard.register('Cattle', 'hồ sơ khám (giả lập)', async (ids) => Object.fromEntries(ids.filter((i) => i === String(withData.id)).map((i) => [i, 2])));
  r = await del(`${C}/${fresh.id}`, A); t('xóa bò chưa có dữ liệu -> xóa cứng', r.status === 200 && r.body.data.deleted[0].mode === 'HARD' && !fake.Cattle.rows.find((c) => c.code === 'N001'));
  t('xóa cứng cũng dọn lịch sử chuồng của bò đó', !fake.PenAssignment.rows.some((m) => String(m.cattleId) === String(fresh.id)));
  r = await get(`${C}/${fresh.id}`, A); t('bò đã xóa cứng -> 404', r.status === 404);
  r = await post(C, body({ code: 'N001', earTag: 'TN1', penId: p2 }), A); t('mã của bò đã xóa cứng dùng lại được', r.status === 201);
  r = await del(`${C}/${withData.id}`, A); t('xóa bò đã có dữ liệu liên quan -> xóa mềm: Không còn trong đàn', r.status === 200 && r.body.data.deleted[0].mode === 'SOFT' && (await get(`${C}/${withData.id}`, A)).body.data.status === 'REMOVED');
  t('xóa mềm có ghi lịch sử trạng thái', fake.CattleStatusHistory.rows.some((h) => String(h.cattleId) === String(withData.id) && h.to === 'REMOVED'));
  r = await del(`${C}/${withData.id}`, A); t('xóa lần nữa bò đã Không còn trong đàn có dữ liệu -> 409 CATTLE_HAS_DATA', r.status === 409 && r.body.error.code === 'CATTLE_HAS_DATA');
  r = await del(`${C}/${G.id}`, A); t('bò đang là bố/mẹ của bò khác -> xóa mềm, không xóa cứng (phả hệ)', r.status === 200 && r.body.data.deleted[0].mode === 'SOFT');
  const x1 = await mkCow({ code: 'X001', earTag: 'TX1' }), x2 = await mkCow({ code: 'X002', earTag: 'TX2' });
  r = await post(`${C}/bulk-delete`, { ids: [x1.id, x2.id, 'dddddddddddddddddddddddd', String(b2)] }, A);
  t('xóa hàng loạt: kết quả từng bò (2 xóa cứng, 1 không tồn tại; B002 đã bán không có dữ liệu -> xóa cứng)', r.status === 200 && r.body.data.deleted.length === 3 && r.body.data.failed[0].code === 'CATTLE_NOT_FOUND');
  r = await del(`${C}/dddddddddddddddddddddddd`, A); t('xóa 1 bò không tồn tại -> 404', r.status === 404);
  t('audit DELETE có mode', auditOf('DELETE', 'cattle').every((a) => a.after?.mode));

  // ================= XÓA CHUỒNG (sau khi đã có lịch sử) =================
  const pe = (await post(P, { code: 'E01', name: 'Trống mới', capacity: 5, zone: 'C' }, A)).body.data.id;
  r = await del(`${P}/${pe}`, A); t('xóa chuồng chưa từng có bò -> xóa cứng, mã dùng lại được', r.status === 200 && r.body.data.deleted[0].mode === 'HARD' && (await post(P, { code: 'E01', name: 'Lại', capacity: 5, zone: 'C' }, A)).status === 201);
  const moved = await mkCow({ code: 'Y001', earTag: 'TY1', penId: p3 });
  await post(`${C}/${moved.id}/move-pen`, { penId: p2 }, A);
  r = await del(`${P}/${p3}`, A); t('xóa chuồng đã có lịch sử nhưng hiện trống -> xóa mềm', r.status === 200 && r.body.data.deleted[0].mode === 'SOFT');
  r = await get(`${P}/${p3}`, A); t('chuồng đã xóa mềm -> 404', r.status === 404);
  r = await get(P, A); t('list chuồng không còn chuồng đã xóa', !r.body.data.items.some((i) => i.code === 'C03'));
  r = await post(P, { code: 'C03', name: 'Lại', capacity: 2, zone: 'A' }, A); t('mã chuồng đã xóa mềm vẫn bị giữ -> 409', r.status === 409);
  r = await post(C, body({ code: 'Z001', earTag: 'TZ1', penId: p3 }), A); t('không xếp bò vào chuồng đã xóa -> 422', r.status === 422);
  r = await post(`${P}/bulk-delete`, { ids: [p1, 'eeeeeeeeeeeeeeeeeeeeeeee'] }, A); t('xóa chuồng hàng loạt: báo lý do từng chuồng', r.status === 200 && r.body.data.failed.map((f) => f.code).sort().join() === 'PEN_NOT_EMPTY,PEN_NOT_FOUND');

  // ================= EXPORT =================
  r = await get(C + '/export?status=RAISING', A);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
  const ws = wb.worksheets[0];
  t('export xlsx: tên file danh-sach-bo_YYYYMMDD_HHmmss.xlsx', r.status === 200 && /filename="danh-sach-bo_\d{8}_\d{6}\.xlsx"/.test(r.headers.get('content-disposition')));
  t('cột export đúng + số dòng = số bò đang nuôi theo bộ lọc', ws.getRow(1).values.slice(1).join('|') === 'Mã bò|Số tai/RFID|Tên|Giống|Chuồng|Giới tính|Ngày sinh|Tuổi (tháng)|Trọng lượng (kg)|Trạng thái|Hình ảnh|Ghi chú' && ws.rowCount - 1 === (await get(C + '?status=RAISING&limit=50', A)).body.data.total);
  const rowOf = (code) => { let found; ws.eachRow((row) => { if (row.getCell(1).value === code) found = row.values.slice(1); }); return found; };
  t('giá trị export: giống, chuồng "mã - tên", giới tính tiếng Việt', rowOf('B001')[3] === 'Brahman Đỏ' && rowOf('B001')[4].startsWith('C01 - ') && rowOf('B001')[5] === 'Cái' && rowOf('B001')[9] === 'Đang nuôi');
  r = await get(C + '/export?scope=all&format=csv&status=SOLD', A); const csv = r.buf.toString('utf8');
  t('scope=all bỏ qua bộ lọc, csv có BOM, có bò đã bán/không còn trong đàn', csv.charCodeAt(0) === 0xfeff && csv.includes('Không còn trong đàn') && csv.includes('Đã bán') === false || csv.includes('Không còn trong đàn'));
  r = await get(C + '/export?status=SOLD', A); t('export không có dữ liệu -> 422 NO_DATA_TO_EXPORT', r.status === 422 && r.body.error.code === 'NO_DATA_TO_EXPORT');
  t('audit EXPORT', auditOf('EXPORT', 'cattle').length === 2);
  const realLen = fake.Cattle.rows.length;
  const proto = fake.Cattle.rows[0];
  for (let i = 0; i < 5001; i++) fake.Cattle.rows.push(Object.assign(Object.create(Object.getPrototypeOf(proto)), proto, { _id: `big${i}`, code: `BIG${i}`, earTag: `BIGT${i}` }));
  r = await get(C + '/export?scope=all', A); t('vượt 5.000 dòng -> 422 EXPORT_TOO_LARGE', r.status === 422 && r.body.error.code === 'EXPORT_TOO_LARGE');
  fake.Cattle.rows.length = realLen;

  // ================= IMPORT =================
  const HEAD = ['Mã bò', 'Số tai', 'Giống', 'Giới tính', 'Ngày sinh', 'Trọng lượng', 'Chuồng', 'Nguồn gốc', 'Ngày nhập đàn'];
  const xlsx = async (rows, head = HEAD) => { const w = new ExcelJS.Workbook(); const s = w.addWorksheet('S'); s.addRow(head); rows.forEach((x) => s.addRow(x)); return Buffer.from(await w.xlsx.writeBuffer()); };
  r = await call('GET', C + '/import/template', null, A);
  const tw = new ExcelJS.Workbook(); await tw.xlsx.load(r.buf);
  t('tải template: đúng cột BRD + ví dụ', r.status === 200 && tw.worksheets[0].getRow(1).values.slice(1).join('|') === 'Mã bò|Số tai|Giống|Giới tính|Ngày sinh|Trọng lượng|Nguồn gốc|Chuồng|Ngày nhập đàn');

  r = await upload(C + '/import/preview', 'x.txt', Buffer.from('abc'), A); t('file không phải xlsx/csv -> 422 INVALID_FILE_TYPE', r.status === 422 && r.body.error.code === 'INVALID_FILE_TYPE');
  r = await call('POST', C + '/import/preview', {}, A); t('không gửi file -> 422', r.status === 422 || r.status === 400 || r.status === 415 || r.status === 500 ? r.status === 422 : false);
  r = await upload(C + '/import/preview', 'bad.xlsx', Buffer.from('không phải xlsx'), A); t('file hỏng -> 422 INVALID_TEMPLATE', r.status === 422 && r.body.error.code === 'INVALID_TEMPLATE');
  r = await upload(C + '/import/preview', 'thieu.xlsx', await xlsx([['A1', 'T', 'x']], ['Mã bò', 'Số tai', 'Giống']), A); t('sai template (thiếu cột) -> từ chối cả file, nêu cột thiếu', r.status === 422 && r.body.error.code === 'INVALID_TEMPLATE' && r.body.error.message.includes('Giới tính'));
  r = await upload(C + '/import/preview', 'rong.xlsx', await xlsx([]), A); t('file chỉ có tiêu đề -> 422', r.status === 422);
  const many = Array.from({ length: 1001 }, (_, i) => [`M${i}`, `T${i}`, 'Angus', 'Đực', '2024-01-01', 100, 'C02', '', '']);
  r = await upload(C + '/import/preview', 'lon.xlsx', await xlsx(many), A); t('quá 1000 dòng -> 422 ROW_LIMIT_EXCEEDED', r.status === 422 && r.body.error.code === 'ROW_LIMIT_EXCEEDED');

  // pen I01 sức chứa 2 để thử hết chỗ; C02 còn nhiều chỗ
  const pi = (await post(P, { code: 'I01', name: 'Chuồng import', capacity: 2, zone: 'D' }, A)).body.data.id;
  const rows = [
    ['I001', 'IT001', 'Angus', 'Đực', '2024-03-15', 300.5, 'C02', 'Sinh sản', ''],        // ok (Ngày nhập đàn trống -> hôm nay)
    ['I002', 'IT002', 'angus', 'cái', '15/03/2024', '450,5', 'c02', 'Mua', '2024-04-01'], // ok: chữ thường, DD/MM/YYYY, dấu phẩy
    ['I003', 'IT003', 'Angus', 'Đực', new Date(Date.UTC(2023, 5, 20)), 280, 'I01', '', ''], // ok: ô ngày Excel
    ['I004', 'IT004', 'Angus', 'Cái', '2024-01-01', 200, 'I01', '', ''],                  // ok (I01 đủ 2/2)
    ['I005', 'IT005', 'Angus', 'Đực', '2024-01-01', 200, 'I01', '', ''],                  // lỗi: chuồng I01 đầy
    ['I006', 'IT006', 'Không có', 'Đực', '2024-01-01', 200, 'C02', '', ''],              // lỗi: giống
    ['I007', 'IT007', 'Angus', 'Đực', '2024-01-01', 200, 'ZZZ', '', ''],                  // lỗi: chuồng
    ['I008', 'IT008', 'Angus', 'Khác', '2024-01-01', 200, 'C02', '', ''],                 // lỗi: giới tính
    ['I001', 'IT009', 'Angus', 'Đực', '2024-01-01', 200, 'C02', '', ''],                  // lỗi: trùng mã trong file (dòng 2)
    ['B001', 'IT010', 'Angus', 'Đực', '2024-01-01', 200, 'C02', '', ''],                  // lỗi: mã đã có trong hệ thống
    ['I011', 'TAG-010', 'Angus', 'Đực', '2024-01-01', 200, 'C02', '', ''],                // lỗi: số tai đã có
    ['I012', 'IT012', 'Angus', 'Đực', '31/02/2024', 200, 'C02', '', ''],                  // lỗi: ngày không tồn tại
    ['I013', 'IT013', 'Angus', 'Đực', '2024-01-01', -3, 'C02', '', ''],                   // lỗi: trọng lượng âm
    ['', 'IT014', 'Angus', 'Đực', '2024-01-01', 200, 'C02', '', ''],                      // lỗi: thiếu mã
    ['I015', 'IT015', 'Angus', 'Đực', '2999-01-01', 200, 'C02', '', ''],                  // lỗi: sinh ở tương lai
  ];
  const nBefore = fake.Cattle.rows.length;
  r = await upload(C + '/import/preview', 'bo.xlsx', await xlsx(rows), A);
  const pv = r.body.data;
  t('preview: 200, tổng 15 dòng, 4 hợp lệ, 11 lỗi', r.status === 200 && pv.summary.total === 15 && pv.summary.valid === 4 && pv.summary.invalid === 11);
  t('preview KHÔNG tạo bò nào', fake.Cattle.rows.length === nBefore);
  const msg = (n) => (pv.errors.find((e) => e.rowNumber === n)?.messages || []).join(' | ');
  t('lỗi chuồng đầy ghi rõ dòng', msg(6).includes('Chuồng I01') && msg(6).includes('đã đầy'));
  t('lỗi giống/chuồng/giới tính nêu đúng cột', msg(7).includes('Giống') && msg(8).includes('Chuồng: "ZZZ"') && msg(9).includes('Giới tính'));
  t('lỗi trùng trong file nêu dòng trùng; trùng hệ thống; trùng số tai', msg(10).includes('trùng với dòng 2') && msg(11).includes('đã tồn tại trong hệ thống') && msg(12).includes('Số tai') && msg(12).includes('đã tồn tại'));
  t('lỗi ngày không tồn tại, trọng lượng âm (không lặp nhãn), thiếu mã, ngày sinh tương lai (không báo dây chuyền)', msg(13).includes('Ngày sinh') && msg(14) === 'Trọng lượng phải là số > 0' && msg(15).includes('Mã bò: bắt buộc') && msg(16).startsWith('Ngày sinh') && !msg(16).includes('Ngày nhập đàn'));
  t('preview trả mẫu dữ liệu hợp lệ + sessionId', pv.sample.length === 4 && !!pv.sessionId);

  r = await call('POST', C + '/import/confirm', { sessionId: pv.sessionId }, A2); t('admin khác không xác nhận được phiên của người khác -> 404', r.status === 404);
  const preOcc = (await get(`${P}/${pi}`, A)).body.data.currentCount;
  // xung đột phát sinh giữa preview và confirm
  await post(C, body({ code: 'I002', earTag: 'XTAG', penId: p2 }), A);
  r = await post(C + '/import/confirm', { sessionId: pv.sessionId }, A);
  const cf = r.body.data;
  t('confirm: tạo 3 bò hợp lệ (I002 vừa bị người khác tạo nên thất bại ở lần kiểm tra lại)', r.status === 200 && cf.summary.success === 3 && cf.summary.failed === 12 && cf.errors.some((e) => e.rowNumber === 3 && e.messages[0].includes('đã tồn tại')));
  const created = ['I001', 'I003', 'I004'].map((c) => fake.Cattle.rows.find((x) => x.code === c));
  t('bò import có đủ dữ liệu: chuẩn hóa ngày, giới tính, mặc định ngày nhập đàn = hôm nay', created.every(Boolean) && created[0].sex === 'MALE' && created[0].weightKg === 300.5 && ymdOf(created[0].joinDate) === today && ymdOf(created[1].birthDate) === '2023-06-20' && created[0].origin === 'BORN');
  t('chuồng I01 đầy 2/2 sau import, có lịch sử nhập chuồng cho bò import', (await get(`${P}/${pi}`, A)).body.data.currentCount === preOcc + 2 && fake.PenAssignment.rows.filter((m) => created.some((c) => String(c._id) === String(m.cattleId))).length === 3);
  r = await post(C + '/import/confirm', { sessionId: pv.sessionId }, A); t('xác nhận lần 2 -> 409 IMPORT_ALREADY_CONFIRMED', r.status === 409 && r.body.error.code === 'IMPORT_ALREADY_CONFIRMED');
  r = await call('GET', `${C}/import/${pv.sessionId}/errors`, null, A);
  const ew = new ExcelJS.Workbook(); await ew.xlsx.load(r.buf);
  t('tải file lỗi: có số dòng, dữ liệu gốc, lý do', r.status === 200 && ew.worksheets[0].rowCount === 13 && ew.worksheets[0].getRow(1).values.slice(1).at(-1) === 'Lý do lỗi' && String(ew.worksheets[0].getRow(2).getCell(1).value).length > 0);
  r = await call('GET', `${C}/import/${pv.sessionId}/errors`, null, A2); t('file lỗi của người khác -> 404', r.status === 404);
  t('audit IMPORT', auditOf('IMPORT', 'cattle').length === 1 && auditOf('IMPORT', 'cattle')[0].meta.success === 3);

  // CSV: BOM, giữ số 0 đầu, ngày DD/MM/YYYY
  const csvText = '\uFEFF' + [HEAD.join(','), '007,IT-CSV,Angus,Đực,01/02/2024,310,C02,Mua,'].join('\n');
  r = await upload(C + '/import/preview', 'bo.csv', Buffer.from(csvText, 'utf8'), A);
  t('csv: đọc được, mã "007" giữ nguyên số 0 đầu, ngày DD/MM/YYYY', r.status === 200 && r.body.data.summary.valid === 1 && r.body.data.sample[0].code === '007' && r.body.data.sample[0].birthDate === '2024-02-01');
  r = await post(C + '/import/confirm', { sessionId: r.body.data.sessionId }, A); t('csv confirm -> tạo bò', r.body.data.summary.success === 1 && !!fake.Cattle.rows.find((c) => c.code === '007'));

  h.close(); origLog(`\n${h.passed()} kiểm tra đạt`); process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
