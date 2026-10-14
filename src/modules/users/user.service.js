'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const STATUS = require('../../constants/accountStatus');
const { normalizeForSearch } = require('../../utils/vietnamese');

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

const buildSearchText = (u) => normalizeForSearch([u.fullName, u.email, u.phone].filter(Boolean).join(' '));

const statusOf = (u) => (u.isLocked ? STATUS.LOCKED : u.isVerified === false ? STATUS.UNVERIFIED : STATUS.ACTIVE);

// statuses: mảng giá trị STATUS (multi-select) -> điều kiện Mongo, hoặc null nếu rỗng
function statusFilter(statuses) {
  if (!statuses?.length) return null;
  const map = {
    [STATUS.ACTIVE]: { isLocked: false, isVerified: true },
    [STATUS.LOCKED]: { isLocked: true },
    [STATUS.UNVERIFIED]: { isLocked: false, isVerified: false },
  };
  return statuses.length === 1 ? map[statuses[0]] : { $or: statuses.map((s) => map[s]) };
}

// Mật khẩu tạm 12 ký tự, đủ hoa/thường/số (thỏa quy tắc mật khẩu), bỏ ký tự dễ nhầm
function generateTempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789'];
  const all = sets.join('');
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const chars = [...sets.map(pick), ...Array.from({ length: 9 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { hashPassword, verifyPassword, buildSearchText, statusOf, statusFilter, generateTempPassword };
