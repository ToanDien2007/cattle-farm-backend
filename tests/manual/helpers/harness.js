'use strict';
// Harness kiểm tra luồng HTTP KHÔNG cần MongoDB: thay các model Mongoose bằng bản giả trong bộ nhớ.
// Model User dùng schema thật (validate, default, hook searchText); phần query/index của MongoDB KHÔNG được kiểm tra.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.OTP_SECRET = 'test-otp-secret';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '../../..');
const req = (p) => require(path.join(ROOT, p));

const get = (d, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), d);
const norm = (v) => (v instanceof Date ? v.getTime() : v != null && typeof v === 'object' && v._bsontype ? String(v) : v);
function cond(v, c) {
  if (c !== null && typeof c === 'object' && !(c instanceof Date) && !c._bsontype && !Array.isArray(c)) {
    return Object.entries(c).every(([op, x]) => {
      const a = norm(v), b = norm(x);
      switch (op) {
        case '$gt': return a > b;
        case '$gte': return a >= b;
        case '$lt': return a < b;
        case '$lte': return a <= b;
        case '$ne': return String(a) !== String(b);
        case '$in': return x.some((y) => String(norm(y)) === String(a));
        case '$regex': return typeof v === 'string' && new RegExp(x).test(v);
        default: throw new Error('fake: operator chưa hỗ trợ ' + op);
      }
    });
  }
  if (c === null) return v === null || v === undefined;
  return String(norm(v)) === String(norm(c));
}
function match(d, f) {
  return Object.entries(f).every(([k, c]) => {
    if (k === '$and') return c.every((x) => match(d, x));
    if (k === '$or') return c.some((x) => match(d, x));
    return cond(get(d, k), c);
  });
}
function apply(d, u) {
  for (const [k, v] of Object.entries(u)) {
    if (k === '$set') Object.assign(d, v);
    else if (k === '$unset') Object.keys(v).forEach((f) => delete d[f]);
    else if (k === '$inc') Object.entries(v).forEach(([f, n]) => (d[f] = (d[f] || 0) + n));
    else d[k] = v;
  }
}
let seq = 0;
function fakeModel({ proto = {}, build } = {}) {
  const rows = [];
  const P = { ...proto, save: async function save() { return this; } };
  const cur = (fn) => {
    const st = { sort: null, skip: 0, limit: Infinity, lean: false };
    const o = {
      select: () => o,
      sort: (s) => ((st.sort = s), o),
      skip: (n) => ((st.skip = n), o),
      limit: (n) => ((st.limit = n), o),
      lean: () => ((st.lean = true), o),
      then: (a, b) => Promise.resolve(fn(st)).then(a, b),
    };
    return o;
  };
  const fin = (d, st) => (d == null ? d : st?.lean ? { ...d } : d);
  const cmp = (sort) => (x, y) => {
    for (const [k, dir] of Object.entries(sort)) {
      const a = norm(get(x, k)), b = norm(get(y, k));
      if (a === b) continue;
      return (a > b ? 1 : -1) * dir;
    }
    return 0;
  };
  return {
    rows,
    create: async (data) => {
      const base = build ? await build(data) : { _id: `id${++seq}`, ...data };
      const d = Object.assign(Object.create(P), { createdAt: new Date(), updatedAt: new Date(), ...base });
      rows.push(d);
      return d;
    },
    find: (f = {}) => cur((st) => {
      let r = rows.filter((d) => match(d, f));
      if (st.sort) r = [...r].sort(cmp(st.sort));
      return r.slice(st.skip, st.skip + st.limit).map((d) => fin(d, st));
    }),
    findOne: (f) => cur((st) => fin(rows.find((d) => match(d, f)) || null, st)),
    countDocuments: async (f = {}) => rows.filter((d) => match(d, f)).length,
    exists: async (f) => (rows.find((d) => match(d, f)) ? { _id: 1 } : null),
    updateOne: async (f, u) => { const d = rows.find((x) => match(x, f)); if (d) apply(d, u); },
    updateMany: async (f, u) => { rows.filter((d) => match(d, f)).forEach((d) => apply(d, u)); },
    deleteOne: async (f) => { const i = rows.findIndex((d) => match(d, f)); if (i >= 0) rows.splice(i, 1); },
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); },
    findOneAndUpdate: async (f, u, o = {}) => {
      const d = rows.find((x) => match(x, f));
      if (!d) return null;
      const before = Object.assign(Object.create(Object.getPrototypeOf(d)), d);
      apply(d, u);
      return o.new ? d : before;
    },
  };
}

function setup() {
  const RealUser = req('src/modules/users/user.model.js'); // model thật (chỉ dùng schema)
  const userBuild = async (data) => {
    const doc = new RealUser(data);
    await doc.validate(); // chạy validate + default + hook searchText thật
    const o = doc.toObject();
    return o;
  };
  const fake = {
    User: fakeModel({ proto: { toPublic: RealUser.schema.methods.toPublic }, build: userBuild }),
    RefreshToken: fakeModel(),
    OtpToken: fakeModel(),
    AuditLog: fakeModel(),
  };
  const stub = (file, m) => { const p = path.join(ROOT, file); const mod = new Module(p); mod.filename = p; mod.loaded = true; mod.exports = m; require.cache[p] = mod; };
  stub('src/modules/users/user.model.js', fake.User);
  stub('src/modules/auth/refreshToken.model.js', fake.RefreshToken);
  stub('src/modules/auth/otpToken.model.js', fake.OtpToken);
  stub('src/shared/audit/auditLog.model.js', fake.AuditLog);

  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let passed = 0;
  const t = (name, ok) => { assert.ok(ok, 'FAIL: ' + name); passed++; origLog('  ✓', name); };
  const lastLog = (needle) => { const l = [...logs].reverse().find((x) => x.includes(needle)); return l; };
  return { fake, logs, origLog, t, passed: () => passed, req, ROOT, lastLog, hash: (p) => req('src/modules/users/user.service.js').hashPassword(p) };
}

async function start() {
  const h = setup();
  const app = req('src/app.js');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
  };
  return { ...h, call, post: (u, b, tk) => call('POST', u, b, tk), get: (u, tk) => call('GET', u, null, tk), patch: (u, b, tk) => call('PATCH', u, b, tk), del: (u, tk) => call('DELETE', u, null, tk), close: () => server.close() };
}

module.exports = { start, ROOT };
