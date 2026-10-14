'use strict';
// Chạy: node tests/manual/verifyAuth.js  (không cần MongoDB, xem helpers/harness.js)
const { start } = require('./helpers/harness');

(async () => {
  const h = await start();
  const { t, post, get, call, fake, logs, lastLog, req, origLog } = h;
  const env = req('src/config/env.js');
  const otpOf = (who) => lastLog(`OTP gửi tới ${who}`).split(': ').pop();
  const reg = (id, name = 'Khach') => post('/auth/register', { fullName: name, identifier: id, newPassword: 'Abcdef12', confirmPassword: 'Abcdef12' });
  const userRow = (field, v) => fake.User.rows.find((u) => u[field] === v);
  const age = async (purposeRow, sec) => { purposeRow.createdAt = new Date(Date.now() - sec * 1000); }; // lùi thời gian tạo OTP

  let r = await get('/health'); t('health 200', r.status === 200);

  // ---- đăng ký + xác thực OTP
  r = await post('/auth/register', { fullName: 'A', identifier: 'abc', newPassword: 'weak', confirmPassword: 'x' });
  t('register không hợp lệ -> 422 + details', r.status === 422 && r.body.error.details.length >= 3);
  r = await reg('+84 912 345 678');
  t('register -> 201, SĐT chuẩn hóa, status UNVERIFIED, không lộ hash', r.status === 201 && r.body.data.phone === '0912345678' && r.body.data.status === 'UNVERIFIED' && !('passwordHash' in r.body.data));
  t('register gửi OTP 6 số', /^\d{6}$/.test(otpOf('0912345678')));
  t('searchText được tạo bởi hook (bỏ dấu, không lộ ra API)', userRow('phone', '0912345678').searchText === 'khach 0912345678');
  r = await reg('0912345678', 'Khach2'); t('register trùng (chưa quá hạn) -> 409', r.status === 409 && r.body.error.code === 'IDENTIFIER_TAKEN');

  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  t('login khi chưa xác thực (đúng MK) -> 403 ACCOUNT_NOT_VERIFIED', r.status === 403 && r.body.error.code === 'ACCOUNT_NOT_VERIFIED');
  const code1 = otpOf('0912345678');
  r = await post('/auth/verify-otp', { identifier: '0912345678', otp: code1 === '000000' ? '111111' : '000000' }); t('verify OTP sai -> 400', r.status === 400 && r.body.error.code === 'INVALID_OTP');
  const n0 = logs.length;
  r = await post('/auth/resend-otp', { identifier: '0912345678' });
  t('resend trong 60s -> 200 nhưng KHÔNG gửi OTP mới', r.status === 200 && logs.length === n0);
  await age(fake.OtpToken.rows[0], 61);
  await post('/auth/resend-otp', { identifier: '0912345678' });
  t('resend sau 60s -> gửi OTP mới', logs.length === n0 + 1);
  const code2 = otpOf('0912345678');
  r = await post('/auth/verify-otp', { identifier: '0912345678', otp: code2 }); t('verify OTP đúng -> 200', r.status === 200);
  t('verifyExpiresAt bị gỡ sau khi xác thực', userRow('phone', '0912345678').verifyExpiresAt === undefined);
  r = await post('/auth/verify-otp', { identifier: '0912345678', otp: code2 }); t('verify lần 2 -> 400', r.status === 400);

  // tài khoản chưa xác thực quá 10 phút -> tự hủy
  await reg('0988000111', 'Het han');
  userRow('phone', '0988000111').verifyExpiresAt = new Date(Date.now() - 1000);
  r = await post('/auth/verify-otp', { identifier: '0988000111', otp: otpOf('0988000111') });
  t('verify khi đã quá hạn -> 400 và tài khoản bị hủy', r.status === 400 && !userRow('phone', '0988000111'));
  await reg('0988000222', 'Het han 2');
  userRow('phone', '0988000222').verifyExpiresAt = new Date(Date.now() - 1000);
  r = await reg('0988000222', 'Dang ky lai'); t('đăng ký lại cùng SĐT sau khi quá hạn -> 201', r.status === 201);

  r = await reg('K@Mail.com'); t('register email -> lowercase', r.status === 201 && r.body.data.email === 'k@mail.com');

  // ---- đăng nhập, khóa tạm
  r = await post('/auth/login', { identifier: '0999999999', password: 'Abcdef12' }); t('login user không tồn tại -> 401 chung', r.status === 401 && r.body.error.code === 'INVALID_CREDENTIALS');
  for (let i = 0; i < 4; i++) r = await post('/auth/login', { identifier: '0912345678', password: 'sai' });
  t('4 lần sai đầu -> vẫn 401 chung', r.status === 401 && r.body.error.code === 'INVALID_CREDENTIALS');
  r = await post('/auth/login', { identifier: '0912345678', password: 'sai' });
  t('lần sai thứ 5 -> 429 LOGIN_TEMPORARILY_LOCKED, còn ~15 phút', r.status === 429 && r.body.error.code === 'LOGIN_TEMPORARILY_LOCKED' && Math.abs(r.body.error.details.retryAfterSeconds - 900) <= 2);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  t('đang khóa tạm: đúng mật khẩu vẫn bị chặn, báo thời gian còn lại', r.status === 429 && r.body.error.details.retryAfterSeconds > 0);
  userRow('phone', '0912345678').loginLockedUntil = new Date(Date.now() - 1000);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  t('hết thời gian khóa -> đăng nhập được, đếm sai về 0', r.status === 200 && userRow('phone', '0912345678').failedLoginCount === 0 && userRow('phone', '0912345678').loginLockedUntil === undefined);
  const { accessToken, refreshToken } = r.body.data;
  for (let i = 0; i < 3; i++) await post('/auth/login', { identifier: '0912345678', password: 'sai' });
  await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  t('3 lần sai rồi đăng nhập đúng -> đếm "liên tiếp" được reset', userRow('phone', '0912345678').failedLoginCount === 0);

  // ---- token
  r = await get('/auth/me'); t('/me không token -> 401', r.status === 401 && r.body.error.code === 'NO_TOKEN');
  r = await get('/auth/me', 'abc.def.ghi'); t('/me token rác -> 401', r.status === 401 && r.body.error.code === 'INVALID_TOKEN');
  r = await get('/auth/me', accessToken); t('/me ok, status ACTIVE', r.status === 200 && r.body.data.status === 'ACTIVE');
  r = await post('/auth/refresh', { refreshToken }); t('refresh -> token mới', r.status === 200 && r.body.data.refreshToken !== refreshToken);
  const rt2 = r.body.data.refreshToken;
  r = await post('/auth/refresh', { refreshToken }); t('dùng lại refresh cũ -> 401', r.status === 401);
  r = await post('/auth/refresh', { refreshToken: rt2 }); t('phát hiện reuse -> thu hồi cả refresh mới', r.status === 401);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  const rt3 = r.body.data.refreshToken;
  r = await post('/auth/logout', { refreshToken: rt3 }); t('logout 200', r.status === 200);
  r = await post('/auth/refresh', { refreshToken: rt3 }); t('refresh sau logout -> 401', r.status === 401);

  // ---- quên mật khẩu
  const n1 = logs.length;
  r = await post('/auth/forgot-password', { identifier: '0900000000' }); t('forgot tài khoản không tồn tại -> 200, không gửi gì', r.status === 200 && logs.length === n1);
  await post('/auth/forgot-password', { identifier: '0988000333' });
  r = await post('/auth/forgot-password', { identifier: '0912345678' }); t('forgot -> 200 + OTP', r.status === 200 && logs.length === n1 + 1);
  let otp = otpOf('0912345678');
  const bad = otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) r = await post('/auth/reset-password', { identifier: '0912345678', otp: bad, newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
  t('OTP sai -> 400 INVALID_OTP', r.status === 400 && r.body.error.code === 'INVALID_OTP');
  r = await post('/auth/reset-password', { identifier: '0912345678', otp, newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
  t('sai 5 lần -> OTP đúng cũng bị khóa', r.status === 400);
  const n2 = logs.length;
  await post('/auth/forgot-password', { identifier: '0912345678' });
  t('gửi lại trong 60s -> không gửi thêm', logs.length === n2);
  await age(fake.OtpToken.rows.find((o) => o.purpose === 'RESET_PASSWORD'), 61);
  await post('/auth/forgot-password', { identifier: '0912345678' }); otp = otpOf('0912345678');
  const live = (await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' })).body.data;
  r = await post('/auth/reset-password', { identifier: '0912345678', otp, newPassword: 'Newpass123', confirmPassword: 'Newpass123' }); t('reset với OTP mới -> 200', r.status === 200);
  r = await post('/auth/reset-password', { identifier: '0912345678', otp, newPassword: 'Another123', confirmPassword: 'Another123' }); t('OTP dùng lại -> 400', r.status === 400);
  r = await post('/auth/refresh', { refreshToken: live.refreshToken }); t('reset thu hồi phiên cũ', r.status === 401);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' }); t('mật khẩu cũ hết hiệu lực', r.status === 401);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Newpass123' }); t('mật khẩu mới đăng nhập được', r.status === 200);
  const tok = r.body.data;
  const unv = await reg('0977000555'); const n3 = logs.length;
  await post('/auth/forgot-password', { identifier: '0977000555' }); t('forgot với tài khoản chưa xác thực -> không gửi OTP reset', logs.length === n3);

  // ---- đổi mật khẩu
  r = await post('/auth/change-password', { currentPassword: 'sai', newPassword: 'Third1234', confirmPassword: 'Third1234' }, tok.accessToken); t('đổi MK sai MK hiện tại -> 400', r.status === 400 && r.body.error.code === 'WRONG_CURRENT_PASSWORD');
  r = await post('/auth/change-password', { currentPassword: 'Newpass123', newPassword: 'Newpass123', confirmPassword: 'Newpass123' }, tok.accessToken); t('MK mới trùng MK cũ -> 422', r.status === 422);
  r = await post('/auth/change-password', { currentPassword: 'Newpass123', newPassword: 'Third1234', confirmPassword: 'Third1234' }, tok.accessToken); t('đổi MK ok -> cấp token mới', r.status === 200 && r.body.data.refreshToken);
  r = await post('/auth/refresh', { refreshToken: tok.refreshToken }); t('đổi MK thu hồi refresh cũ', r.status === 401);

  // ---- mustChangePassword, khóa, phân quyền
  const mk = async (data, pw) => fake.User.create({ passwordHash: await h.hash(pw), ...data });
  const admin = await mk({ fullName: 'Admin', email: 'admin@x.com', role: 'ADMIN', mustChangePassword: true }, 'Temp12345');
  r = await post('/auth/login', { identifier: 'admin@x.com', password: 'Temp12345' }); const at = r.body.data;
  t('admin login mật khẩu tạm -> flag mustChangePassword', r.status === 200 && at.user.mustChangePassword === true);
  r = await get('/admin/accounts', at.accessToken); t('mustChangePassword chặn /admin -> 403 PASSWORD_CHANGE_REQUIRED', r.status === 403 && r.body.error.code === 'PASSWORD_CHANGE_REQUIRED');
  r = await get('/auth/me', at.accessToken); t('/me vẫn dùng được khi phải đổi MK', r.status === 200);
  r = await post('/auth/change-password', { currentPassword: 'Temp12345', newPassword: 'Admin12345', confirmPassword: 'Admin12345' }, at.accessToken); t('admin đổi MK lần đầu ok', r.status === 200);
  r = await get('/admin/accounts', r.body.data.accessToken); t('sau đó vào được /admin', r.status === 200);
  r = await get('/admin/accounts', tok.accessToken); t('CUSTOMER vào /admin -> 403', r.status === 403);
  admin.isLocked = true;
  r = await post('/auth/login', { identifier: 'admin@x.com', password: 'Admin12345' }); t('tài khoản bị khóa -> 403 ACCOUNT_LOCKED', r.status === 403 && r.body.error.code === 'ACCOUNT_LOCKED');
  r = await get('/admin/accounts', at.accessToken); t('token cũ của tài khoản bị khóa -> 403', r.status === 403);

  r = await h.call('POST', '/auth/login', null); t('thiếu body -> 422', r.status === 422);
  r = await get('/khong-co'); t('route lạ -> 404 JSON', r.status === 404 && r.body.error.code === 'ROUTE_NOT_FOUND');

  h.close(); origLog(`\n${h.passed()} kiểm tra đạt`); process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
