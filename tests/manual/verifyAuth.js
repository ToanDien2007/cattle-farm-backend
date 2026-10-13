// Chạy: node tests/manual/verifyAuth.js
// Kiểm tra luồng HTTP của auth; 3 model Mongoose được thay bằng bản giả trong bộ nhớ nên KHÔNG cần MongoDB.
// (Không kiểm tra index/unique thật của MongoDB - phần đó cần chạy với DB thật.)
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.OTP_SECRET = 'test-otp-secret';
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const assert = require('assert');

function match(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && '$gt' in cond) return v > cond.$gt;
    if (cond === null) return v === null || v === undefined;
    return String(v) === String(cond);
  });
}
let seq = 0;
function fakeModel(proto = {}) {
  const rows = [];
  const q = (fn) => { const o = { select: () => o, then: (a, b) => Promise.resolve(fn()).then(a, b) }; return o; };
  const apply = (d, upd) => { for (const [k, v] of Object.entries(upd)) { if (k === '$inc') for (const [f, n] of Object.entries(v)) d[f] = (d[f] || 0) + n; else d[k] = v; } };
  return {
    rows,
    create: async (data) => { const d = Object.assign(Object.create({ ...proto, save: async function () { return this; } }), { _id: `id${++seq}`, ...data }); rows.push(d); return d; },
    findOne: (f) => q(() => rows.find((d) => match(d, f)) || null),
    exists: async (f) => (rows.find((d) => match(d, f)) ? { _id: 1 } : null),
    updateOne: async (f, u) => { const d = rows.find((x) => match(x, f)); if (d) apply(d, u); },
    updateMany: async (f, u) => { rows.filter((d) => match(d, f)).forEach((d) => apply(d, u)); },
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); },
    findOneAndUpdate: async (f, u) => { const d = rows.find((x) => match(x, f)); if (!d) return null; const before = { ...d }; apply(d, u); return before; },
  };
}
const mongoose = require(path.join(ROOT, 'node_modules/mongoose'));
const realUser = require(path.join(ROOT, 'src/modules/users/user.model.js'));
const fake = { User: fakeModel({ toPublic: realUser.schema.methods.toPublic }), RefreshToken: fakeModel(), OtpToken: fakeModel() };
for (const [file, m] of [['users/user.model.js', fake.User], ['auth/refreshToken.model.js', fake.RefreshToken], ['auth/otpToken.model.js', fake.OtpToken]]) {
  const p = path.join(ROOT, 'src/modules', file); const Module = require('module'); const mod = new Module(p); mod.filename = p; mod.loaded = true; mod.exports = m; require.cache[p] = mod;
}

const app = require(path.join(ROOT, 'src/app.js'));
const express = require(path.join(ROOT, 'node_modules/express'));
const authenticate = require(path.join(ROOT, 'src/middlewares/authenticate.js'));
const authorize = require(path.join(ROOT, 'src/middlewares/authorize.js'));
const errorHandler = require(path.join(ROOT, 'src/middlewares/errorHandler.js'));
const probe = express();
probe.get('/admin-only', authenticate(), authorize('ADMIN'), (req, res) => res.json({ ok: true }));
probe.use(errorHandler);

const logs = []; const origLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
let passed = 0;
const t = (name, ok) => { assert.ok(ok, 'FAIL: ' + name); passed++; origLog('  ✓', name); };

(async () => {
  const s1 = app.listen(0), s2 = probe.listen(0);
  const base = `http://127.0.0.1:${s1.address().port}/api/v1`, pbase = `http://127.0.0.1:${s2.address().port}`;
  const call = async (method, url, body, token, raw) => {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: raw ?? (body && JSON.stringify(body)) });
    return { status: r.status, body: await r.json() };
  };
  const post = (p, b, tk) => call('POST', base + p, b, tk);

  let r = await call('GET', base + '/health'); t('health 200', r.status === 200);
  r = await post('/auth/register', { fullName: 'A', identifier: 'abc', newPassword: 'weak', confirmPassword: 'x' });
  t('register không hợp lệ -> 422 + details', r.status === 422 && r.body.error.details.length >= 3);
  r = await post('/auth/register', { fullName: 'Khach', identifier: '+84 912 345 678', newPassword: 'Abcdef12', confirmPassword: 'Abcdef12' });
  t('register SĐT +84 -> 201, chuẩn hóa 0912345678, không lộ hash', r.status === 201 && r.body.data.phone === '0912345678' && r.body.data.role === 'CUSTOMER' && !('passwordHash' in r.body.data));
  r = await post('/auth/register', { fullName: 'Khach2', identifier: '0912345678', newPassword: 'Abcdef12', confirmPassword: 'Abcdef12' });
  t('register trùng -> 409', r.status === 409 && r.body.error.code === 'IDENTIFIER_TAKEN');
  r = await post('/auth/register', { fullName: 'K', identifier: 'K@Mail.com', newPassword: 'Abcdef12', confirmPassword: 'Abcdef12' });
  t('register email -> lowercase', r.status === 201 && r.body.data.email === 'k@mail.com');

  r = await post('/auth/login', { identifier: '0912345678', password: 'sai' });
  t('login sai mật khẩu -> 401', r.status === 401 && r.body.error.code === 'INVALID_CREDENTIALS');
  r = await post('/auth/login', { identifier: '0999999999', password: 'Abcdef12' });
  t('login user không tồn tại -> cùng lỗi 401', r.status === 401 && r.body.error.code === 'INVALID_CREDENTIALS');
  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  t('login ok -> access + refresh', r.status === 200 && r.body.data.accessToken && r.body.data.refreshToken);
  const { accessToken, refreshToken } = r.body.data;

  r = await call('GET', base + '/auth/me'); t('/me không token -> 401', r.status === 401 && r.body.error.code === 'NO_TOKEN');
  r = await call('GET', base + '/auth/me', null, 'abc.def.ghi'); t('/me token rác -> 401', r.status === 401 && r.body.error.code === 'INVALID_TOKEN');
  r = await call('GET', base + '/auth/me', null, accessToken); t('/me ok', r.status === 200 && r.body.data.phone === '0912345678');
  r = await call('GET', pbase + '/admin-only', null, accessToken); t('CUSTOMER vào route ADMIN -> 403', r.status === 403);

  r = await post('/auth/refresh', { refreshToken }); t('refresh -> token mới', r.status === 200 && r.body.data.refreshToken !== refreshToken);
  const rt2 = r.body.data.refreshToken;
  r = await post('/auth/refresh', { refreshToken }); t('dùng lại refresh cũ -> 401', r.status === 401);
  r = await post('/auth/refresh', { refreshToken: rt2 }); t('phát hiện reuse -> thu hồi cả refresh mới', r.status === 401);

  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' });
  const rt3 = r.body.data.refreshToken;
  r = await post('/auth/logout', { refreshToken: rt3 }); t('logout 200', r.status === 200);
  r = await post('/auth/refresh', { refreshToken: rt3 }); t('refresh sau logout -> 401', r.status === 401);

  // quên mật khẩu
  r = await post('/auth/forgot-password', { identifier: '0900000000' });
  t('forgot với tài khoản không tồn tại -> vẫn 200 (không lộ)', r.status === 200 && !logs.some((l) => l.includes('0900000000')));
  const otpOf = (who) => { const l = [...logs].reverse().find((x) => x.includes(`gửi tới ${who}`)); return l.split(': ').pop(); };
  r = await post('/auth/forgot-password', { identifier: '0912345678' }); t('forgot -> 200', r.status === 200);
  let otp = otpOf('0912345678'); t('OTP 6 số', /^\d{6}$/.test(otp));
  const bad = otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) r = await post('/auth/reset-password', { identifier: '0912345678', otp: bad, newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
  t('OTP sai -> 400 INVALID_OTP', r.status === 400 && r.body.error.code === 'INVALID_OTP');
  r = await post('/auth/reset-password', { identifier: '0912345678', otp, newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
  t('sai 5 lần -> OTP đúng cũng bị khóa', r.status === 400);
  await post('/auth/forgot-password', { identifier: '0912345678' }); otp = otpOf('0912345678');
  const live = (await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' })).body.data;
  r = await post('/auth/reset-password', { identifier: '0912345678', otp, newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
  t('reset với OTP mới -> 200', r.status === 200);
  r = await post('/auth/reset-password', { identifier: '0912345678', otp, newPassword: 'Another123', confirmPassword: 'Another123' });
  t('OTP dùng lại -> 400', r.status === 400);
  r = await post('/auth/refresh', { refreshToken: live.refreshToken }); t('reset thu hồi phiên cũ', r.status === 401);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Abcdef12' }); t('mật khẩu cũ hết hiệu lực', r.status === 401);
  r = await post('/auth/login', { identifier: '0912345678', password: 'Newpass123' }); t('mật khẩu mới đăng nhập được', r.status === 200);
  const tok = r.body.data;

  // đổi mật khẩu
  r = await post('/auth/change-password', { currentPassword: 'sai', newPassword: 'Third1234', confirmPassword: 'Third1234' }, tok.accessToken);
  t('đổi MK sai MK hiện tại -> 400', r.status === 400 && r.body.error.code === 'WRONG_CURRENT_PASSWORD');
  r = await post('/auth/change-password', { currentPassword: 'Newpass123', newPassword: 'Newpass123', confirmPassword: 'Newpass123' }, tok.accessToken);
  t('MK mới trùng MK cũ -> 422', r.status === 422);
  r = await post('/auth/change-password', { currentPassword: 'Newpass123', newPassword: 'Third1234', confirmPassword: 'Third1234' }, tok.accessToken);
  t('đổi MK ok -> cấp token mới', r.status === 200 && r.body.data.refreshToken);
  r2 = await post('/auth/refresh', { refreshToken: tok.refreshToken }); t('đổi MK thu hồi refresh cũ', r2.status === 401);

  // mustChangePassword + khóa tài khoản + admin
  const admin = await fake.User.create({ fullName: 'Admin', email: 'admin@x.com', passwordHash: await require(path.join(ROOT, 'src/modules/users/user.service.js')).hashPassword('Temp12345'), role: 'ADMIN', mustChangePassword: true });
  r = await post('/auth/login', { identifier: 'admin@x.com', password: 'Temp12345' }); const at = r.body.data;
  t('admin login (mật khẩu tạm) -> flag mustChangePassword', r.status === 200 && at.user.mustChangePassword === true);
  r = await call('GET', pbase + '/admin-only', null, at.accessToken); t('mustChangePassword chặn route thường -> 403 PASSWORD_CHANGE_REQUIRED', r.status === 403 && r.body.error.code === 'PASSWORD_CHANGE_REQUIRED');
  r = await call('GET', base + '/auth/me', null, at.accessToken); t('/me vẫn dùng được khi phải đổi MK', r.status === 200);
  r = await post('/auth/change-password', { currentPassword: 'Temp12345', newPassword: 'Admin12345', confirmPassword: 'Admin12345' }, at.accessToken);
  t('admin đổi MK lần đầu ok', r.status === 200);
  r = await call('GET', pbase + '/admin-only', null, r.body.data.accessToken); t('sau đó vào được route ADMIN', r.status === 200);
  admin.isLocked = true;
  r = await post('/auth/login', { identifier: 'admin@x.com', password: 'Admin12345' }); t('tài khoản bị khóa -> 403 ACCOUNT_LOCKED', r.status === 403 && r.body.error.code === 'ACCOUNT_LOCKED');
  r = await call('GET', pbase + '/admin-only', null, at.accessToken); t('token cũ của tài khoản bị khóa -> 403', r.status === 403);

  r = await call('POST', base + '/auth/login', null, null, '{bad json'); t('JSON hỏng -> 400', r.status === 400 && r.body.error.code === 'INVALID_JSON');
  r = await call('GET', base + '/khong-co'); t('route lạ -> 404 JSON', r.status === 404 && r.body.error.code === 'ROUTE_NOT_FOUND');

  s1.close(); s2.close(); origLog(`\n${passed} kiểm tra đạt`); process.exit(0);
})().catch((e) => { origLog(e.message); process.exit(1); });
