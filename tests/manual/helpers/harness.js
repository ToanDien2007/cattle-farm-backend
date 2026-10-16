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
function fakeModel({ proto = {}, build, real } = {}) {
  const rows = [];
  const P = {
    ...proto,
    save: async function save() {
      if (real) { const d = new real(this); await d.validate(); if (d.searchText !== undefined) this.searchText = d.searchText; }
      return this;
    },
  };
  const cur = (fn) => {
    const st = { sort: null, skip: 0, limit: Infinity, lean: false };
    const o = {
      select: () => o,
      session: () => o,
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
      const make = async (item) => {
        const base = build ? await build(item) : { _id: `id${++seq}`, ...item };
        const d = Object.assign(Object.create(P), { createdAt: new Date(), updatedAt: new Date(), ...base });
        rows.push(d);
        return d;
      };
      if (Array.isArray(data)) { const out = []; for (const item of data) out.push(await make(item)); return out; }
      return make(data);
    },
    aggregate: async (pipe) => {
      let r = rows;
      for (const st of pipe) {
        if (st.$match) r = r.filter((d) => match(d, st.$match));
        else if (st.$group) {
          const f = st.$group._id.slice(1), m = new Map();
          r.forEach((d) => { const k = String(get(d, f)); m.set(k, (m.get(k) || 0) + 1); });
          r = [...m].map(([k, n]) => ({ _id: k, count: n }));
        } else throw new Error('fake: aggregate stage chưa hỗ trợ');
      }
      return r;
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
  const realBuild = (Real) => async (data) => {
    const doc = new Real(data);
    await doc.validate(); // chạy validate + default + hook thật
    return doc.toObject();
  };
  const R = {
    Breed: req('src/modules/farm/breeds/breed.model.js'),
    Pen: req('src/modules/farm/pens/pen.model.js'),
    PenAssignment: req('src/modules/farm/pens/penAssignment.model.js'),
    Cattle: req('src/modules/farm/cattle/cattle.model.js'),
    CattleStatusHistory: req('src/modules/farm/cattle/cattleStatusHistory.model.js'),
    ImportSession: req('src/shared/import/importSession.model.js'),
    HealthRecord: req('src/modules/farm/health/health-records/healthRecord.model.js'),
    Vaccination: req('src/modules/farm/health/vaccinations/vaccination.model.js'),
    Quarantine: req('src/modules/farm/health/quarantine/quarantine.model.js'),
    MilkRecord: req('src/modules/farm/production/milk-records/milkRecord.model.js'),
  };
  const fromReal = (Real) => fakeModel({ build: realBuild(Real), real: Real });
  const fake = {
    User: fakeModel({ proto: { toPublic: RealUser.schema.methods.toPublic }, build: realBuild(RealUser), real: RealUser }),
    RefreshToken: fakeModel(),
    OtpToken: fakeModel(),
    AuditLog: fakeModel(),
    Breed: fromReal(R.Breed), Pen: fromReal(R.Pen), PenAssignment: fromReal(R.PenAssignment), Cattle: fromReal(R.Cattle),
    CattleStatusHistory: fromReal(R.CattleStatusHistory), ImportSession: fromReal(R.ImportSession),
    HealthRecord: fromReal(R.HealthRecord), Vaccination: fromReal(R.Vaccination), Quarantine: fromReal(R.Quarantine),
    MilkRecord: fromReal(R.MilkRecord),
  };
  require('mongoose').startSession = async () => ({ withTransaction: async (fn) => { await fn(); }, endSession: async () => {} }); // không mô phỏng rollback
  const stub = (file, m) => { const p = path.join(ROOT, file); const mod = new Module(p); mod.filename = p; mod.loaded = true; mod.exports = m; require.cache[p] = mod; };
  stub('src/modules/users/user.model.js', fake.User);
  stub('src/modules/auth/refreshToken.model.js', fake.RefreshToken);
  stub('src/modules/auth/otpToken.model.js', fake.OtpToken);
  stub('src/shared/audit/auditLog.model.js', fake.AuditLog);
  stub('src/modules/farm/breeds/breed.model.js', fake.Breed);
  stub('src/modules/farm/pens/pen.model.js', fake.Pen);
  stub('src/modules/farm/pens/penAssignment.model.js', fake.PenAssignment);
  stub('src/modules/farm/cattle/cattle.model.js', fake.Cattle);
  stub('src/modules/farm/cattle/cattleStatusHistory.model.js', fake.CattleStatusHistory);
  stub('src/shared/import/importSession.model.js', fake.ImportSession);
  stub('src/modules/farm/health/health-records/healthRecord.model.js', fake.HealthRecord);
  stub('src/modules/farm/health/vaccinations/vaccination.model.js', fake.Vaccination);
  stub('src/modules/farm/health/quarantine/quarantine.model.js', fake.Quarantine);
  stub('src/modules/farm/production/milk-records/milkRecord.model.js', fake.MilkRecord);

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
  const upload = async (url, name, buffer, token) => {
    const fd = new FormData();
    fd.append('file', new Blob([buffer]), name);
    const r = await fetch(base + url, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : null };
  };
  return { ...h, call, upload, put: (u, b, tk) => call('PUT', u, b, tk), post: (u, b, tk) => call('POST', u, b, tk), get: (u, tk) => call('GET', u, null, tk), patch: (u, b, tk) => call('PATCH', u, b, tk), del: (u, tk) => call('DELETE', u, null, tk), close: () => server.close() };
}

module.exports = { start, ROOT };