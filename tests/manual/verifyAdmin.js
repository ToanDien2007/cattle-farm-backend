'use strict';
// Chạy: node tests/manual/verifyAdmin.js  (không cần MongoDB, xem helpers/harness.js)
const ExcelJS = require('exceljs');
const { start } = require('./helpers/harness');

(async () => {
  const h = await start();
  const { t, post, get, patch, del, call, fake, logs, lastLog, req, origLog } = h;
  const env = req('src/config/env.js');
  const mk = async (data, pw = 'Abcdef12') => fake.User.create({ passwordHash: await h.hash(pw), ...data });
  const login = async (id, pw = 'Abcdef12') => (await post('/auth/login', { identifier: id, password: pw })).body.data;
  const auditOf = (action) => fake.AuditLog.rows.filter((a) => a.action === action);

  const admin = await mk({ fullName: 'Quản Trị', email: 'root@farm.vn', role: 'ADMIN' });
  const A = (await login('root@farm.vn')).accessToken;
  let r;

  // ================= ACCOUNTS =================
  r = await get('/admin/accounts'); t('không token -> 401', r.status === 401);
  r = await post('/admin/accounts', { fullName: 'X' }, A); t('tạo thiếu email -> 422 báo lỗi từng trường', r.status === 422 && r.body.error.details.some((d) => d.field === 'body.email'));
  r = await post('/admin/accounts', { fullName: 'Nguyễn Văn Đức', email: 'Duc@Farm.vn', phone: '+84 901 234 567' }, A);
  t('tạo tài khoản nhân sự -> 201, email lowercase, SĐT chuẩn hóa, role ADMIN, phải đổi MK', r.status === 201 && r.body.data.email === 'duc@farm.vn' && r.body.data.phone === '0901234567' && r.body.data.role === 'ADMIN' && r.body.data.mustChangePassword === true);
  const ducId = r.body.data.id;
  const temp = lastLog('Mật khẩu tạm gửi tới duc@farm.vn').split(': ').pop();
  t('mật khẩu tạm 12 ký tự có hoa/thường/số, không bị lộ trong response', temp.length === 12 && /[a-z]/.test(temp) && /[A-Z]/.test(temp) && /\d/.test(temp) && !JSON.stringify(r.body).includes(temp));
  r = await post('/admin/accounts', { fullName: 'Trùng', email: 'duc@farm.vn' }, A); t('trùng email -> 409 EMAIL_TAKEN', r.status === 409 && r.body.error.code === 'EMAIL_TAKEN');
  r = await post('/admin/accounts', { fullName: 'Trùng SĐT', email: 'x@farm.vn', phone: '0901234567' }, A); t('trùng SĐT -> 409 PHONE_TAKEN', r.status === 409 && r.body.error.code === 'PHONE_TAKEN');
  r = await post('/admin/accounts', { fullName: 'Role lạ', email: 'y@farm.vn', role: 'CUSTOMER' }, A); t('role không hợp lệ -> 422', r.status === 422);

  const ducLogin = await post('/auth/login', { identifier: 'duc@farm.vn', password: temp });
  t('đăng nhập bằng mật khẩu tạm được, bị ép đổi MK', ducLogin.status === 200 && ducLogin.body.data.user.mustChangePassword === true);
  r = await get('/admin/accounts', ducLogin.body.data.accessToken); t('...và bị chặn /admin tới khi đổi MK', r.status === 403 && r.body.error.code === 'PASSWORD_CHANGE_REQUIRED');

  // gửi mail lỗi -> hoàn tác
  const before = fake.User.rows.length;
  env.NODE_ENV = 'production';
  r = await post('/admin/accounts', { fullName: 'Mail lỗi', email: 'fail@farm.vn' }, A);
  env.NODE_ENV = 'test';
  t('gửi email lỗi -> 502 và KHÔNG để lại tài khoản', r.status === 502 && r.body.error.code === 'EMAIL_SEND_FAILED' && fake.User.rows.length === before);

  await post('/admin/accounts', { fullName: 'Trần Thị Bình', email: 'binh@farm.vn' }, A);
  await post('/admin/accounts', { fullName: 'Lê Đức Anh', email: 'anh@farm.vn', phone: '0912000111' }, A);
  r = await get('/admin/accounts', A);
  t('list mặc định: phân trang 20, có tổng, mới nhất trước, không có khách hàng', r.status === 200 && r.body.data.limit === 20 && r.body.data.total === 4 && r.body.data.items[0].email === 'anh@farm.vn' && r.body.data.items.every((i) => i.role === 'ADMIN'));
  t('list không lộ passwordHash/searchText', !JSON.stringify(r.body).match(/passwordHash|searchText/));
  r = await get('/admin/accounts?limit=15', A); t('limit không thuộc 10/20/50 -> 422', r.status === 422);
  r = await get('/admin/accounts?limit=10&page=2', A); t('trang vượt quá -> items rỗng, total giữ nguyên', r.status === 200 && r.body.data.items.length === 0 && r.body.data.total === 4);
  r = await get('/admin/accounts?q=duc', A); t('tìm "duc" khớp "Nguyễn Văn Đức" và "Lê Đức Anh" (bỏ dấu, hoa/thường)', r.body.data.total === 2);
  r = await get('/admin/accounts?q=' + encodeURIComponent('ĐỨC'), A); t('tìm "ĐỨC" -> cùng 2 kết quả', r.body.data.total === 2);
  r = await get('/admin/accounts?q=0912', A); t('tìm theo SĐT', r.body.data.total === 1);
  r = await get('/admin/accounts?q=binh@farm', A); t('tìm theo email', r.body.data.total === 1);
  r = await get('/admin/accounts?q=' + encodeURIComponent('.*'), A); t('ký tự regex được escape', r.body.data.total === 0);
  r = await get('/admin/accounts?sortBy=fullName&order=asc', A); t('sắp xếp fullName tăng dần', r.body.data.items[0].fullName <= r.body.data.items[1].fullName);
  r = await get('/admin/accounts?status=LOCKED', A); t('lọc trạng thái Đã khóa -> rỗng', r.body.data.total === 0);
  r = await get('/admin/accounts?status=ACTIVE,LOCKED', A); t('lọc multi-select', r.body.data.total === 4);
  r = await get('/admin/accounts?status=NOPE', A); t('trạng thái lạ -> 422', r.status === 422);

  r = await get(`/admin/accounts/${ducId}`, A); t('chi tiết -> 200', r.status === 200 && r.body.data.email === 'duc@farm.vn');
  r = await get('/admin/accounts/abc', A); t('id sai định dạng -> 422', r.status === 422);
  r = await get('/admin/accounts/aaaaaaaaaaaaaaaaaaaaaaaa', A); t('không tồn tại -> 404', r.status === 404 && r.body.error.code === 'ACCOUNT_NOT_FOUND');

  r = await patch(`/admin/accounts/${ducId}`, {}, A); t('sửa body rỗng -> 422', r.status === 422);
  r = await patch(`/admin/accounts/${ducId}`, { email: 'binh@farm.vn' }, A); t('sửa trùng email -> 409', r.status === 409 && r.body.error.code === 'EMAIL_TAKEN');
  r = await patch(`/admin/accounts/${ducId}`, { fullName: 'Phạm Hữu Nghĩa', phone: '0933444555' }, A);
  t('sửa họ tên + SĐT -> 200', r.status === 200 && r.body.data.fullName === 'Phạm Hữu Nghĩa' && r.body.data.phone === '0933444555');
  r = await get('/admin/accounts?q=nghia', A); t('tìm theo tên MỚI được (searchText cập nhật)', r.body.data.total === 1);
  r = await get('/admin/accounts?q=nguyen', A); t('tên cũ không còn khớp', r.body.data.total === 0);
  r = await patch(`/admin/accounts/${ducId}`, { phone: null }, A); t('phone=null -> xóa SĐT', r.status === 200 && !r.body.data.phone);

  // xóa
  r = await del(`/admin/accounts/${admin._id}`, A); t('tự xóa chính mình -> 409', r.status === 409 && r.body.error.code === 'CANNOT_DELETE_SELF');
  r = await post('/admin/accounts/bulk-delete', { ids: [] }, A); t('bulk-delete rỗng -> 422', r.status === 422);
  r = await post('/admin/accounts/bulk-delete', { ids: [String(ducId), 'bbbbbbbbbbbbbbbbbbbbbbbb'] }, A);
  t('bulk-delete có id không tồn tại -> 404 kèm danh sách id, không xóa gì', r.status === 404 && r.body.error.details[0] === 'bbbbbbbbbbbbbbbbbbbbbbbb' && fake.User.rows.find((u) => String(u._id) === String(ducId)).deletedAt === null);
  const ducTok = (await login('duc@farm.vn', temp)).refreshToken;
  r = await del(`/admin/accounts/${ducId}`, A); t('xóa mềm -> 200', r.status === 200 && r.body.data.deleted === 1);
  const dRow = fake.User.rows.find((u) => String(u._id) === String(ducId));
  t('bản ghi vẫn còn trong DB (xóa mềm): deletedAt + isLocked', dRow.deletedAt instanceof Date && dRow.isLocked === true);
  r = await get(`/admin/accounts/${ducId}`, A); t('chi tiết bản ghi đã xóa -> 404', r.status === 404);
  r = await get('/admin/accounts', A); t('list không còn bản ghi đã xóa', r.body.data.total === 3);
  r = await patch(`/admin/accounts/${ducId}`, { fullName: 'Z' }, A); t('sửa bản ghi đã xóa -> 404', r.status === 404);
  r = await post('/auth/login', { identifier: 'duc@farm.vn', password: temp }); t('tài khoản đã xóa không đăng nhập được', r.status === 401);
  r = await post('/auth/refresh', { refreshToken: ducTok }); t('phiên của tài khoản đã xóa bị thu hồi', r.status === 401);
  r = await post('/admin/accounts', { fullName: 'Dùng lại email', email: 'duc@farm.vn' }, A); t('email của tài khoản đã xóa vẫn bị giữ -> 409', r.status === 409);

  // khóa -> sửa bị xung đột
  const bId = fake.User.rows.find((u) => u.email === 'binh@farm.vn')._id;
  fake.User.rows.find((u) => u.email === 'binh@farm.vn').isLocked = true;
  r = await patch(`/admin/accounts/${bId}`, { fullName: 'Z' }, A); t('sửa tài khoản đang bị khóa -> 409 RECORD_CONFLICT', r.status === 409 && r.body.error.code === 'RECORD_CONFLICT');
  r = await get('/admin/accounts?status=LOCKED', A); t('lọc Đã khóa thấy tài khoản bị khóa', r.body.data.total === 1);
  fake.User.rows.find((u) => u.email === 'binh@farm.vn').isLocked = false;

  // admin duy nhất
  const svc = req('src/modules/accounts/account.service.js');
  const others = fake.User.rows.filter((u) => u.role === 'ADMIN' && u.deletedAt === null && String(u._id) !== String(admin._id));
  others.forEach((u) => (u.isLocked = true)); // chỉ còn root hoạt động
  let err; try { await svc.remove({ user: { _id: 'khac' }, ip: '1', get: () => '' }, [String(admin._id)]); } catch (e) { err = e; }
  t('xóa quản trị viên hoạt động cuối cùng -> 409 LAST_ADMIN', err?.code === 'LAST_ADMIN');
  others.forEach((u) => (u.isLocked = false));

  t('audit: CREATE/UPDATE/DELETE có người thực hiện + trước/sau', auditOf('CREATE').length >= 3 && auditOf('UPDATE').length === 2 && auditOf('DELETE').length === 1 && auditOf('UPDATE')[0].before && auditOf('UPDATE')[0].after && String(auditOf('DELETE')[0].actorId) === String(admin._id));
  t('audit không chứa mật khẩu/hash/mật khẩu tạm', !JSON.stringify(fake.AuditLog.rows).match(/passwordHash|searchText/) && !JSON.stringify(fake.AuditLog.rows).includes(temp));

  // ================= CUSTOMERS =================
  const day = (s) => new Date(s);
  const cust = {};
  const mkC = async (key, data) => (cust[key] = await mk({ role: 'CUSTOMER', ...data }));
  await mkC('an', { fullName: 'Nguyễn Văn An', email: 'an@gmail.com', phone: '0911000001', stats: { totalSpent: 5000000, orderCount: 3 } });
  await mkC('binh', { fullName: 'Trần Bình', phone: '0911000002', stats: { totalSpent: 12000000, orderCount: 7 } });
  await mkC('chi', { fullName: 'Lê Thị Chi', email: 'chi@gmail.com', isLocked: true, lockReason: 'Spam' });
  await mkC('dung', { fullName: 'Đặng Dũng', email: 'dung@gmail.com', isVerified: false, verifyExpiresAt: new Date(Date.now() + 600000) });
  await mkC('evil', { fullName: '=HYPERLINK("http://evil")', email: 'evil@gmail.com' });
  cust.an.createdAt = day('2026-10-01T16:59:59Z'); // 23:59:59 ngày 01/10 giờ VN
  cust.binh.createdAt = day('2026-10-01T17:00:00Z'); // 00:00:00 ngày 02/10 giờ VN
  cust.chi.createdAt = day('2026-09-15T05:00:00Z');
  cust.dung.createdAt = day('2026-10-10T05:00:00Z');
  cust.evil.createdAt = day('2026-10-11T05:00:00Z');

  r = await get('/admin/customers', A);
  t('list khách: chỉ CUSTOMER, mặc định mới đăng ký nhất trước, có cột chi tiêu/số đơn/trạng thái', r.status === 200 && r.body.data.total === 5 && r.body.data.items[0].fullName.startsWith('=') && 'totalSpent' in r.body.data.items[0] && 'orderCount' in r.body.data.items[0] && r.body.data.items[0].status === 'ACTIVE');
  r = await get('/admin/customers?sortBy=totalSpent&order=desc', A); t('sắp xếp theo Tổng chi tiêu giảm dần', r.body.data.items[0].fullName === 'Trần Bình' && r.body.data.items[1].fullName === 'Nguyễn Văn An');
  r = await get('/admin/customers?sortBy=hacker', A); t('sortBy ngoài danh sách -> 422', r.status === 422);
  r = await get('/admin/customers?q=nguyen', A); t('tìm bỏ dấu theo tên', r.body.data.total === 1);
  r = await get('/admin/customers?q=0911000002', A); t('tìm theo SĐT', r.body.data.total === 1);
  r = await get('/admin/customers?q=gmail', A); t('tìm theo email (contains)', r.body.data.total === 4);
  r = await get('/admin/customers?status=LOCKED,UNVERIFIED', A); t('lọc multi-select Đã khóa + Chưa xác thực', r.body.data.total === 2);
  r = await get('/admin/customers?status=ACTIVE', A); t('lọc Hoạt động', r.body.data.total === 3);
  r = await get('/admin/customers?registeredFrom=2026-10-01&registeredTo=2026-10-01', A); t('khoảng thời gian tính theo GMT+7, gồm đủ ngày: 23:59:59 ngày 01/10 có, 00:00:00 ngày 02/10 không', r.body.data.total === 1 && r.body.data.items[0].fullName === 'Nguyễn Văn An');
  r = await get('/admin/customers?registeredFrom=2026-10-02', A); t('chỉ có "từ ngày"', r.body.data.total === 3);
  r = await get('/admin/customers?registeredFrom=2026-10-05&registeredTo=2026-10-01', A); t('từ ngày > đến ngày -> 422', r.status === 422);
  r = await get('/admin/customers?registeredFrom=2026-13-45', A); t('ngày không hợp lệ -> 422', r.status === 422);
  r = await get('/admin/customers?q=khongco', A); t('không có kết quả -> items rỗng', r.status === 200 && r.body.data.total === 0 && r.body.data.items.length === 0);
  r = await get('/admin/customers?status=ACTIVE&q=gmail&registeredFrom=2026-10-05', A); t('kết hợp nhiều bộ lọc (AND)', r.body.data.total === 1);

  r = await get(`/admin/customers/${cust.an._id}`, A); t('chi tiết khách (có orders/reviews rỗng chờ module sau)', r.status === 200 && r.body.data.fullName === 'Nguyễn Văn An' && Array.isArray(r.body.data.orders) && Array.isArray(r.body.data.reviews));
  r = await get(`/admin/customers/${admin._id}`, A); t('id của admin không xem được qua /customers -> 404', r.status === 404);

  // khóa / mở khóa
  const anTok = (await login('0911000001')).refreshToken;
  r = await post(`/admin/customers/${cust.an._id}/lock`, { reason: 'Vi phạm điều khoản' }, A);
  t('khóa khách -> 200 status LOCKED', r.status === 200 && r.body.data.status === 'LOCKED');
  t('gửi email thông báo kèm lý do cho khách', !!lastLog('Thông báo khóa tài khoản gửi tới an@gmail.com (lý do: Vi phạm điều khoản)'));
  r = await post('/auth/login', { identifier: '0911000001', password: 'Abcdef12' }); t('khách bị khóa không đăng nhập được', r.status === 403 && r.body.error.code === 'ACCOUNT_LOCKED');
  r = await post('/auth/refresh', { refreshToken: anTok }); t('phiên của khách bị khóa bị thu hồi', r.status === 401);
  r = await post(`/admin/customers/${cust.an._id}/lock`, {}, A); t('khóa lần 2 -> 409 ALREADY_LOCKED', r.status === 409 && r.body.error.code === 'ALREADY_LOCKED');
  r = await post(`/admin/customers/${cust.an._id}/lock`, {}, A); 
  r = await get(`/admin/customers/${cust.an._id}`, A); t('chi tiết hiển thị lý do khóa', r.body.data.lockReason === 'Vi phạm điều khoản' && r.body.data.status === 'LOCKED');
  r = await post(`/admin/customers/${cust.an._id}/unlock`, null, A); t('mở khóa -> ACTIVE', r.status === 200 && r.body.data.status === 'ACTIVE');
  t('mở khóa xóa lý do khóa', cust.an.lockReason === undefined && cust.an.lockedAt === undefined);
  r = await post('/auth/login', { identifier: '0911000001', password: 'Abcdef12' }); t('mở khóa xong đăng nhập lại được', r.status === 200);
  r = await post(`/admin/customers/${cust.an._id}/unlock`, null, A); t('mở khóa khi không bị khóa -> 409 NOT_LOCKED', r.status === 409 && r.body.error.code === 'NOT_LOCKED');
  const n = logs.length;
  r = await post(`/admin/customers/${cust.binh._id}/lock`, { reason: 'x'.repeat(501) }, A); t('lý do > 500 ký tự -> 422', r.status === 422);
  r = await post(`/admin/customers/${cust.binh._id}/lock`, {}, A); t('khóa khách chỉ có SĐT (không email) -> vẫn thành công, không gửi mail', r.status === 200 && !logs.slice(n).some((l) => l.includes('Thông báo')));
  r = await post(`/admin/customers/${admin._id}/lock`, {}, A); t('khóa nhầm admin qua /customers -> 404', r.status === 404);
  t('audit LOCK/UNLOCK', auditOf('LOCK').length === 2 && auditOf('UNLOCK').length === 1 && auditOf('LOCK')[0].after.reason === 'Vi phạm điều khoản');

  // export
  r = await get('/admin/customers/export?status=ACTIVE', A);
  t('export xlsx: 200, đúng content-type, tên file khach-hang_YYYYMMDD_HHmmss.xlsx', r.status === 200 && /spreadsheetml/.test(r.headers.get('content-type')) && /filename="khach-hang_\d{8}_\d{6}\.xlsx"/.test(r.headers.get('content-disposition')));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
  const ws = wb.worksheets[0];
  const headers = ws.getRow(1).values.slice(1);
  t('xlsx đọc lại được, cột đúng BRD và KHÔNG có mật khẩu', headers.join('|') === 'Họ tên|Email|SĐT|Tổng chi tiêu (VND)|Số đơn hàng|Trạng thái|Ngày đăng ký');
  t('xlsx: số dòng = số khách theo bộ lọc hiện tại (ACTIVE: An, Evil = 2 sau khi Bình bị khóa)', ws.rowCount - 1 === 2);
  r = await get('/admin/customers/export?scope=all&format=csv', A);
  const csv = r.buf.toString('utf8');
  t('export csv: có BOM UTF-8, scope=all lấy đủ 5 khách (bỏ qua bộ lọc)', csv.charCodeAt(0) === 0xfeff && csv.trim().split('\n').length === 6);
  t('csv chống formula injection (=HYPERLINK... được thêm dấu nháy)', csv.includes("'=HYPERLINK") && !/(^|,|")=HYPERLINK/.test(csv));
  t('csv có tiếng Việt đúng', csv.includes('Nguyễn Văn An') && csv.includes('Đã khóa'));
  r = await get('/admin/customers/export?q=khongco', A); t('export không có dữ liệu -> 422 NO_DATA_TO_EXPORT', r.status === 422 && r.body.error.code === 'NO_DATA_TO_EXPORT');
  r = await get('/admin/customers/export?format=pdf', A); t('format lạ -> 422', r.status === 422);
  const ex = auditOf('EXPORT');
  t('audit EXPORT: người thực hiện, thời gian, bộ lọc, số dòng', ex.length === 2 && ex[0].meta.rows === 2 && ex[0].meta.filter.status[0] === 'ACTIVE' && ex[1].meta.scope === 'all' && ex[0].createdAt instanceof Date && !!ex[0].actorId);
  const exportsCount = auditOf('EXPORT').length;
  r = await get('/admin/customers/export?q=khongco', A); t('export thất bại không ghi audit', auditOf('EXPORT').length === exportsCount);

  h.close(); origLog(`\n${h.passed()} kiểm tra đạt`); process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
