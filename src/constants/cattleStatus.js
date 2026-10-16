'use strict';

const CATTLE_STATUS = Object.freeze({
  RAISING: 'RAISING', // Đang nuôi
  TREATING: 'TREATING', // Đang điều trị (module health đặt)
  QUARANTINED: 'QUARANTINED', // Cách ly (module health đặt)
  SOLD: 'SOLD', // Đã bán
  DEAD: 'DEAD', // Đã chết
  REMOVED: 'REMOVED', // Không còn trong đàn (xuất chuồng / loại thải / xóa mềm)
});

const CATTLE_STATUS_LABEL = Object.freeze({
  RAISING: 'Đang nuôi',
  TREATING: 'Đang điều trị',
  QUARANTINED: 'Cách ly',
  SOLD: 'Đã bán',
  DEAD: 'Đã chết',
  REMOVED: 'Không còn trong đàn',
});

// Bò còn trong đàn: chiếm chỗ trong chuồng, tính vào "số bò thuộc giống"
const IN_HERD = [CATTLE_STATUS.RAISING, CATTLE_STATUS.TREATING, CATTLE_STATUS.QUARANTINED];
// Bò không còn nhận nghiệp vụ mới (ghi sản lượng, tiêm phòng...)
const NON_OPERABLE = [CATTLE_STATUS.SOLD, CATTLE_STATUS.DEAD, CATTLE_STATUS.REMOVED];
// Chỉ bò ở các trạng thái này mới được "Chuyển trạng thái"
const TRANSITIONABLE_FROM = [CATTLE_STATUS.RAISING, CATTLE_STATUS.TREATING];

const REMOVAL_TYPE = Object.freeze({ CULLED: 'CULLED', SHIPPED_OUT: 'SHIPPED_OUT' });
const REMOVAL_TYPE_LABEL = Object.freeze({ CULLED: 'Loại thải', SHIPPED_OUT: 'Xuất chuồng' });

const SEX = Object.freeze({ MALE: 'MALE', FEMALE: 'FEMALE' });
const SEX_LABEL = Object.freeze({ MALE: 'Đực', FEMALE: 'Cái' });
const ORIGIN = Object.freeze({ BORN: 'BORN', PURCHASED: 'PURCHASED' });
const ORIGIN_LABEL = Object.freeze({ BORN: 'Sinh sản', PURCHASED: 'Mua' });

module.exports = {
  CATTLE_STATUS, CATTLE_STATUS_LABEL, IN_HERD, NON_OPERABLE, TRANSITIONABLE_FROM,
  REMOVAL_TYPE, REMOVAL_TYPE_LABEL, SEX, SEX_LABEL, ORIGIN, ORIGIN_LABEL,
};
