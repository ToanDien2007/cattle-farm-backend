'use strict';
const env = require('../../config/env');

let transporter;
function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// Chưa cấu hình SMTP: dev in ra console, production báo lỗi. devLog chỉ dùng ở dev.
async function sendMail({ to, subject, text, devLog }) {
  const t = getTransporter();
  if (!t) {
    if (env.NODE_ENV === 'production') throw new Error('SMTP chưa được cấu hình');
    console.log(`[DEV] ${devLog || `Mail tới ${to}: ${subject} - ${text}`}`);
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

const OTP_COPY = {
  RESET_PASSWORD: { subject: 'Mã OTP khôi phục mật khẩu', what: 'khôi phục mật khẩu', ttl: () => env.OTP_TTL_MINUTES },
  VERIFY_ACCOUNT: { subject: 'Mã OTP xác thực tài khoản', what: 'xác thực tài khoản', ttl: () => env.VERIFY_TTL_MINUTES },
};

// channel: 'email' | 'phone'
async function sendOtp(user, code, { channel, purpose = 'RESET_PASSWORD' }) {
  const c = OTP_COPY[purpose];
  const text = `Mã OTP ${c.what} của bạn là ${code}. Mã có hiệu lực ${c.ttl()} phút. Không chia sẻ mã này cho bất kỳ ai.`;

  if (channel === 'email') {
    return sendMail({ to: user.email, subject: c.subject, text, devLog: `OTP gửi tới ${user.email}: ${code}` });
  }
  // TODO: tích hợp nhà cung cấp SMS (BRD: khách hàng nhận OTP qua email/SĐT)
  if (env.NODE_ENV === 'production') throw new Error('Chưa tích hợp SMS provider');
  console.log(`[DEV] OTP gửi tới ${user.phone}: ${code}`);
}

const sendTempPassword = (user, tempPassword) =>
  sendMail({
    to: user.email,
    subject: 'Tài khoản quản trị - mật khẩu tạm',
    text: `Xin chào ${user.fullName}, tài khoản của bạn đã được tạo. Mật khẩu tạm: ${tempPassword}. Bạn bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.`,
    devLog: `Mật khẩu tạm gửi tới ${user.email}: ${tempPassword}`,
  });

// Thông báo khóa/mở khóa tài khoản khách (chỉ gửi được khi khách có email)
const sendAccountStatusNotice = (user, { locked, reason }) =>
  sendMail({
    to: user.email,
    subject: locked ? 'Tài khoản của bạn đã bị khóa' : 'Tài khoản của bạn đã được mở khóa',
    text: locked
      ? `Tài khoản của bạn đã bị khóa.${reason ? ` Lý do: ${reason}.` : ''} Vui lòng liên hệ cửa hàng nếu cần hỗ trợ.`
      : 'Tài khoản của bạn đã được mở khóa, bạn có thể đăng nhập trở lại.',
    devLog: `Thông báo ${locked ? 'khóa' : 'mở khóa'} tài khoản gửi tới ${user.email}${reason ? ` (lý do: ${reason})` : ''}`,
  });

module.exports = { sendMail, sendOtp, sendTempPassword, sendAccountStatusNotice };
