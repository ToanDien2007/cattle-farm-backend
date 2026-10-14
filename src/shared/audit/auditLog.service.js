'use strict';
const AuditLog = require('./auditLog.model');

// Ghi nhật ký thao tác (người thực hiện, thời gian, dữ liệu trước/sau). Lỗi ghi log không làm hỏng nghiệp vụ.
// KHÔNG đưa passwordHash/OTP vào before/after.
async function record(req, { action, module, entity, entityId, before, after, meta }) {
  try {
    await AuditLog.create({
      actorId: req.user?._id,
      actorRole: req.user?.role,
      action,
      module,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      before,
      after,
      meta,
      ip: req.ip,
      userAgent: req.get?.('user-agent'),
    });
  } catch (err) {
    console.error('Ghi audit log thất bại:', err.message);
  }
}

module.exports = { record };
