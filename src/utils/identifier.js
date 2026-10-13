'use strict';

// Email/SĐT -> { type: 'email' | 'phone', value } (đã chuẩn hóa) hoặc null nếu không hợp lệ
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizePhone(raw) {
  let p = String(raw).replace(/[\s.\-()]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length === 11) p = '0' + p.slice(2);
  return /^0\d{9}$/.test(p) ? p : null;
}

function parseIdentifier(raw) {
  const s = String(raw ?? '').trim();
  if (s.includes('@')) {
    const email = s.toLowerCase();
    return EMAIL_RE.test(email) ? { type: 'email', value: email } : null;
  }
  const phone = normalizePhone(s);
  return phone ? { type: 'phone', value: phone } : null;
}

module.exports = { parseIdentifier, normalizePhone };
