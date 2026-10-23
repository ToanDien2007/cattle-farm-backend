'use strict';

const MILK_SHIFT = Object.freeze({ MORNING: 'MORNING', AFTERNOON: 'AFTERNOON' });
const MILK_SHIFT_LABEL = Object.freeze({ MORNING: 'Sáng', AFTERNOON: 'Chiều' });

const MEAT_PRODUCT_TYPE = Object.freeze({ FRESH: 'FRESH', PROCESSED: 'PROCESSED' });
const MEAT_PRODUCT_TYPE_LABEL = Object.freeze({ FRESH: 'Thịt tươi', PROCESSED: 'Thịt chế biến' });

// DRAFT: nháp, còn sửa/xóa được. TRANSFERRED: lô đã xuất sang Kho sản phẩm đầu ra (khóa)
const MEAT_STATUS = Object.freeze({ DRAFT: 'DRAFT', TRANSFERRED: 'TRANSFERRED' });
const MEAT_STATUS_LABEL = Object.freeze({ DRAFT: 'Nháp', TRANSFERRED: 'Đã xuất kho' });

const PRODUCTION_RULES = Object.freeze({
  MILK_DELETE_WINDOW_HOURS: 24, // chỉ xóa bản ghi nhập sai trong 24h
});

module.exports = {
MILK_SHIFT, MILK_SHIFT_LABEL, MEAT_PRODUCT_TYPE, MEAT_PRODUCT_TYPE_LABEL, MEAT_STATUS, MEAT_STATUS_LABEL, PRODUCTION_RULES,
};