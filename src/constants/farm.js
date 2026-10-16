'use strict';
const BREED_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', HIDDEN: 'HIDDEN' }); // Đang dùng / Đã ẩn
const BREED_STATUS_LABEL = Object.freeze({ ACTIVE: 'Đang dùng', HIDDEN: 'Đã ẩn' });

const PEN_FILL = Object.freeze({ AVAILABLE: 'AVAILABLE', NEARLY_FULL: 'NEARLY_FULL', FULL: 'FULL' }); // Còn chỗ / Gần đầy (≥90%) / Đầy
const PEN_FILL_LABEL = Object.freeze({ AVAILABLE: 'Còn chỗ', NEARLY_FULL: 'Gần đầy', FULL: 'Đầy' });
const NEARLY_FULL_PERCENT = 90;

module.exports = { BREED_STATUS, BREED_STATUS_LABEL, PEN_FILL, PEN_FILL_LABEL, NEARLY_FULL_PERCENT };
