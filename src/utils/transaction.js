'use strict';
const mongoose = require('mongoose');

// Chạy fn(session) trong transaction (cần MongoDB replica set). fn có thể bị chạy lại khi lỗi tạm thời
// => bên trong KHÔNG đặt tác vụ có hiệu ứng ngoài DB (gửi mail, audit...).
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction };
