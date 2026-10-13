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

// channel: 'email' | 'phone'
async function sendOtp(user, code, { channel }) {
  const text = `Mã OTP khôi phục mật khẩu của bạn là ${code}. Mã có hiệu lực ${env.OTP_TTL_MINUTES} phút. Không chia sẻ mã này cho bất kỳ ai.`;

  if (channel === 'email') {
    const t = getTransporter();
    if (!t) {
      if (env.NODE_ENV === 'production') throw new Error('SMTP chưa được cấu hình');
      console.log(`[DEV] OTP gửi tới ${user.email}: ${code}`);
      return;
    }
    await t.sendMail({ from: env.MAIL_FROM, to: user.email, subject: 'Mã OTP khôi phục mật khẩu', text });
    return;
  }

  // TODO: tích hợp nhà cung cấp SMS (BRD: khách hàng khôi phục qua email/SĐT)
  if (env.NODE_ENV === 'production') throw new Error('Chưa tích hợp SMS provider');
  console.log(`[DEV] OTP gửi tới ${user.phone}: ${code}`);
}

module.exports = { sendOtp };
