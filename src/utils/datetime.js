'use strict';
// Nghiệp vụ tính theo GMT+7; DB lưu Date (UTC)
const VN_OFFSET_MS = 7 * 3600 * 1000;

const startOfDayVN = (ymd) => new Date(`${ymd}T00:00:00+07:00`);
const endOfDayVN = (ymd) => new Date(`${ymd}T23:59:59.999+07:00`);
// Kiểm tra bằng cách dựng lại ngày: new Date('2024-02-31') của V8 không báo lỗi mà tự nhảy sang 02/03
const isValidYmd = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

// 20261014_153045 (giờ VN) - dùng đặt tên file export
const formatStampVN = (d = new Date()) =>
  new Date(d.getTime() + VN_OFFSET_MS).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

// 14/10/2026 15:30 (giờ VN)
const formatDateTimeVN = (d) => {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}`;
};

// Hôm nay (giờ VN) dạng YYYY-MM-DD
const todayYmdVN = (now = new Date()) => new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
const ymdOf = (date) => new Date(new Date(date).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

// Cộng/trừ tháng theo lịch VN (kẹp ngày cuối tháng), trả về Date đầu ngày VN
function shiftMonthsVN(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12 + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const pad = (x) => String(x).padStart(2, '0');
  return startOfDayVN(`${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`);
}

// Tuổi tròn tháng tính đến hôm nay (giờ VN)
function ageInMonthsVN(birthDate, now = new Date()) {
  const [by, bm, bd] = ymdOf(birthDate).split('-').map(Number);
  const [ny, nm, nd] = todayYmdVN(now).split('-').map(Number);
  return Math.max(0, (ny - by) * 12 + (nm - bm) - (nd < bd ? 1 : 0));
}

module.exports = { todayYmdVN, ymdOf, shiftMonthsVN, ageInMonthsVN, startOfDayVN, endOfDayVN, isValidYmd, formatStampVN, formatDateTimeVN };
