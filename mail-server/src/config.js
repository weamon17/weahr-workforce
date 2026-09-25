import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const directory = path.dirname(fileURLToPath(import.meta.url));

// Keep production secrets in the hosting provider. Local development secrets
// belong only in mail-server/.env and are never loaded from the React project.
dotenv.config({ path: path.resolve(directory, '../.env'), override: false, quiet: true });

const integer = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
};

const origins = String(process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: integer(process.env.PORT, 8787, 1, 65535),
  allowedOrigins: origins,
  gmailUser: String(process.env.GMAIL_USER || '').trim().toLowerCase(),
  gmailAppPassword: String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  mailFromName: String(process.env.MAIL_FROM_NAME || 'WeaHR').trim().slice(0, 80),
  firebaseProjectId: String(process.env.FIREBASE_PROJECT_ID || '').trim(),
  firebaseClientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
  firebasePrivateKey: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  authContinueUrl: String(process.env.AUTH_CONTINUE_URL || '').trim(),
  emailCooldownMs: integer(process.env.EMAIL_COOLDOWN_SECONDS, 60, 30, 3600) * 1000,
  ipWindowMs: integer(process.env.IP_WINDOW_SECONDS, 900, 60, 86400) * 1000,
  ipMaxRequests: integer(process.env.IP_MAX_REQUESTS, 10, 2, 100),
});

export const assertConfig = () => {
  const missing = [];
  const placeholder = value => !value || /PASTE_|xxxx|your-|example/i.test(value);
  if (placeholder(config.gmailUser)) missing.push('GMAIL_USER');
  if (placeholder(config.gmailAppPassword)) missing.push('GMAIL_APP_PASSWORD');
  if (!config.firebaseProjectId) missing.push('FIREBASE_PROJECT_ID');
  const usesApplicationDefault = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const usesInlineCredential = Boolean(config.firebaseClientEmail && config.firebasePrivateKey);
  if (!usesApplicationDefault && !usesInlineCredential) {
    missing.push('GOOGLE_APPLICATION_CREDENTIALS hoặc FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY');
  }
  if (usesApplicationDefault && !existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    throw new Error('File GOOGLE_APPLICATION_CREDENTIALS không tồn tại. Hãy cập nhật đường dẫn service-account JSON.');
  }
  if (config.nodeEnv === 'production' && config.allowedOrigins.some(origin => origin.includes('localhost'))) {
    throw new Error('ALLOWED_ORIGINS production không được chứa localhost.');
  }
  if (missing.length) throw new Error(`Thiếu cấu hình mail server: ${missing.join(', ')}`);
};
