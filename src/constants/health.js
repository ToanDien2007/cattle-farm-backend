'use strict';

const CONCLUSION = Object.freeze({ HEALTHY: 'HEALTHY', MONITORING: 'MONITORING', SICK: 'SICK' });
const CONCLUSION_LABEL = Object.freeze({ HEALTHY: 'Khỏe mạnh', MONITORING: 'Cần theo dõi', SICK: 'Bệnh' });

// Trạng thái lịch tiêm: suy ra từ Ngày tái tiêm (không lưu)
const VACCINATION_STATUS = Object.freeze({ DONE: 'DONE', DUE_SOON: 'DUE_SOON', OVERDUE: 'OVERDUE' });
const VACCINATION_STATUS_LABEL = Object.freeze({ DONE: 'Đã tiêm', DUE_SOON: 'Sắp đến hạn', OVERDUE: 'Quá hạn' });

const QUARANTINE_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', ENDED: 'ENDED' });
const QUARANTINE_STATUS_LABEL = Object.freeze({ ACTIVE: 'Đang cách ly', ENDED: 'Đã kết thúc' });
// Kết thúc cách ly: khỏi -> Đang nuôi; chưa khỏi -> quay lại Đang điều trị
const QUARANTINE_OUTCOME = Object.freeze({ RECOVERED: 'RECOVERED', CONTINUE_TREATMENT: 'CONTINUE_TREATMENT' });
const QUARANTINE_OUTCOME_LABEL = Object.freeze({ RECOVERED: 'Đã khỏi', CONTINUE_TREATMENT: 'Tiếp tục điều trị' });

const HEALTH_RULES = Object.freeze({
  HEALTH_EDIT_WINDOW_HOURS: 24, // sửa hồ sơ khám tự do trong 24h, sau đó cần xác nhận bổ sung
  VACCINATION_DATE_EDIT_WINDOW_HOURS: 48, // không sửa Ngày tiêm sau 48h
  VACCINATION_DELETE_WINDOW_HOURS: 24, // chỉ xóa bản ghi tạo nhầm trong 24h
  EXPORT_MAX_MONTHS: 24, // export hồ sơ khám: tối đa 2 năm gần nhất
  DUE_SOON_DAYS: 7,
});

// Giá trị sắp xếp cho bản ghi không còn lịch tái tiêm (xếp cuối khi sắp xếp tăng dần)
const NO_DUE_DATE = new Date(Date.UTC(9999, 11, 31));

// Cặp vaccine chống chỉ định khi tiêm cùng ngày cho cùng 1 bò, vd ['Vaccine A', 'Vaccine B'] (so khớp không dấu/hoa thường).
// BRD chưa cung cấp danh mục => để trống; thú y điền vào đây (hoặc chuyển sang collection cấu hình sau).
const VACCINE_CONTRAINDICATIONS = [];

module.exports = {
  CONCLUSION, CONCLUSION_LABEL, VACCINATION_STATUS, VACCINATION_STATUS_LABEL,
  QUARANTINE_STATUS, QUARANTINE_STATUS_LABEL, QUARANTINE_OUTCOME, QUARANTINE_OUTCOME_LABEL,
  HEALTH_RULES, NO_DUE_DATE, VACCINE_CONTRAINDICATIONS,
};