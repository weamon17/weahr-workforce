import nodemailer from 'nodemailer';
import { config } from './config.js';

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  pool: true,
  maxConnections: 2,
  maxMessages: 50,
  auth: {
    user: config.gmailUser,
    pass: config.gmailAppPassword,
  },
});

const brandedEmail = ({ title, greeting, description, actionLabel, actionUrl }) => ({
  subject: `${title} · WeaHR`,
  text: `${greeting}\n\n${description}\n\n${actionLabel}: ${actionUrl}\n\nNếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.`,
  html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="padding:24px 30px;background:linear-gradient(135deg,#4f46e5,#0ea5e9);color:#fff">
        <div style="font-size:24px;font-weight:800">WeaHR</div>
        <div style="margin-top:5px;opacity:.9">Workforce intelligence for F&amp;B</div>
      </div>
      <div style="padding:30px">
        <h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1>
        <p style="line-height:1.65">${escapeHtml(greeting)}</p>
        <p style="line-height:1.65;color:#475569">${escapeHtml(description)}</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">${escapeHtml(actionLabel)}</a>
        </p>
        <p style="font-size:13px;line-height:1.5;color:#64748b">
          Liên kết này có thời hạn do Firebase Authentication quản lý.
          Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.
        </p>
      </div>
    </div>
  </body>
</html>`,
});

export const sendBrandedMail = async ({ to, ...content }) => transport.sendMail({
  from: `"${config.mailFromName}" <${config.gmailUser}>`,
  replyTo: config.gmailUser,
  to,
  ...brandedEmail(content),
});
