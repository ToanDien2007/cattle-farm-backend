'use strict';

const MILK_SHIFT = Object.freeze({ MORNING: 'MORNING', AFTERNOON: 'AFTERNOON' });
const MILK_SHIFT_LABEL = Object.freeze({ MORNING: 'Sáng', AFTERNOON: 'Chiều' });

const PRODUCTION_RULES = Object.freeze({
  MILK_DELETE_WINDOW_HOURS: 24, // chỉ xóa bản ghi nhập sai trong 24h
});

module.exports = { MILK_SHIFT, MILK_SHIFT_LABEL, PRODUCTION_RULES };