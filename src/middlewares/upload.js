'use strict';
const multer = require('multer');
const ApiError = require('../utils/ApiError');

// File Excel/CSV nhỏ (import), giữ trong bộ nhớ, tối đa 5MB
const uploadSheet = (field = 'file') => {
  const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single(field);
  return (req, res, next) =>
    m(req, res, (err) => {
      if (err) return next(err);
      if (!req.file) return next(ApiError.unprocessable('Vui lòng chọn file để tải lên', undefined, 'FILE_REQUIRED'));
      if (!/\.(xlsx|csv)$/i.test(req.file.originalname)) {
        return next(ApiError.unprocessable('Chỉ hỗ trợ file .xlsx hoặc .csv', undefined, 'INVALID_FILE_TYPE'));
      }
      next();
    });
};

module.exports = { uploadSheet };
