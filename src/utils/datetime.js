'use strict';
// Nghiệp vụ tính theo GMT+7; DB lưu Date (UTC)
const VN_OFFSET_MS = 7 * 3600 * 1000;

const startOfDayVN = (ymd) => new Date(`${ymd}T00:00:00+07:00`);
const endOfDayVN = (ymd) => new Date(`${ymd}T23:59:59.999+07:00`);
const isValidYmd = (ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(startOfDayVN(ymd).getTime());

// 20261014_153045 (giờ VN) - dùng đặt tên file export
const formatStampVN = (d = new Date()) =>
  new Date(d.getTime() + VN_OFFSET_MS).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

// 14/10/2026 15:30 (giờ VN)
const formatDateTimeVN = (d) => {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}`;
};

module.exports = { startOfDayVN, endOfDayVN, isValidYmd, formatStampVN, formatDateTimeVN };
