import crypto from 'node:crypto';
import express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { config } from './config.js';
import { createAttendanceRouter } from './attendanceRoutes.js';

const normalizeEmail = value => String(value || '').trim().toLowerCase().slice(0, 254);
const safeId = value => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 1200);
const sha256 = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const actionSettings = () => config.authContinueUrl
  ? { url: config.authContinueUrl, handleCodeInApp: false }
  : undefined;

const errorResponse = (response, status, code, message) => response.status(status).json({
  ok: false,
  error: { code, message },
});

const bearerToken = request => {
  const match = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
};

const createIpLimiter = () => {
  const buckets = new Map();
  return request => {
    const now = Date.now();
    const key = sha256(request.ip || request.socket.remoteAddress || 'unknown');
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + config.ipWindowMs });
      return true;
    }
    if (current.count >= config.ipMaxRequests) return false;
    current.count += 1;
    if (buckets.size > 5000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return true;
  };
};

export const createApp = ({ auth, firestore, sendMail }) => {
  const app = express();
  const allowIpRequest = createIpLimiter();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      response.set('Access-Control-Allow-Origin', origin);
      response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      if (origin && !config.allowedOrigins.includes(origin)) return response.sendStatus(403);
      return response.sendStatus(204);
    }
    if (origin && !config.allowedOrigins.includes(origin)) {
      return errorResponse(response, 403, 'origin-not-allowed', 'Nguồn yêu cầu không được phép.');
    }
    return next();
  });

  const reserveEmailDispatch = async key => {
    const reference = firestore.collection('email_dispatch_limits').doc(safeId(key));
    await firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const lastSentAt = snapshot.data()?.lastSentAt?.toMillis?.() || 0;
      if (Date.now() - lastSentAt < config.emailCooldownMs) {
        const error = new Error('Vui lòng đợi trước khi yêu cầu gửi lại email.');
        error.code = 'cooldown';
        throw error;
      }
      transaction.set(reference, {
        keyHash: sha256(key),
        lastSentAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      }, { merge: true });
    });
  };

  app.get('/health', (_request, response) => response.json({
    ok: true,
    service: 'weahr-mail-server',
  }));

  app.post('/v1/auth/verification-email', async (request, response) => {
    if (!allowIpRequest(request)) {
      return errorResponse(response, 429, 'too-many-requests', 'Bạn đã gửi quá nhiều yêu cầu.');
    }
    try {
      const token = bearerToken(request);
      if (!token) return errorResponse(response, 401, 'unauthenticated', 'Thiếu Firebase ID token.');
      const decodedToken = await auth.verifyIdToken(token, true);
      const email = normalizeEmail(decodedToken.email);
      if (!email) return errorResponse(response, 400, 'email-missing', 'Tài khoản chưa có email.');
      if (decodedToken.email_verified) return response.json({ ok: true, sent: false, alreadyVerified: true });

      const user = await auth.getUser(decodedToken.uid);
      if (user.emailVerified) return response.json({ ok: true, sent: false, alreadyVerified: true });
      if (normalizeEmail(user.email) !== email) {
        return errorResponse(response, 403, 'email-mismatch', 'Email token không khớp tài khoản.');
      }

      await reserveEmailDispatch(`verify_${decodedToken.uid}`);
      const link = await auth.generateEmailVerificationLink(email, actionSettings());
      await sendMail({
        to: email,
        title: 'Xác thực địa chỉ email',
        greeting: `Xin chào ${user.displayName || email},`,
        description: 'Hãy xác thực email để kích hoạt tài khoản WeaHR và bảo vệ workspace của bạn.',
        actionLabel: 'Xác thực email',
        actionUrl: link,
      });
      return response.json({ ok: true, sent: true });
    } catch (error) {
      if (error?.code === 'cooldown') {
        return errorResponse(response, 429, 'cooldown', error.message);
      }
      console.error('verification-email failed', { code: error?.code, message: error?.message });
      return errorResponse(response, 500, 'email-send-failed', 'Không thể gửi email xác thực lúc này.');
    }
  });

  app.post('/v1/auth/password-reset', async (request, response) => {
    const accepted = () => response.json({
      ok: true,
      accepted: true,
      message: 'Nếu email tồn tại, WeaHR đã gửi liên kết đặt lại mật khẩu.',
    });
    if (!allowIpRequest(request)) return accepted();

    const email = normalizeEmail(request.body?.email);
    if (!email || !email.includes('@')) {
      await sleep(200);
      return accepted();
    }

    try {
      await reserveEmailDispatch(`reset_${sha256(email)}`);
      const user = await auth.getUserByEmail(email);
      const link = await auth.generatePasswordResetLink(email, actionSettings());
      await sendMail({
        to: email,
        title: 'Đặt lại mật khẩu',
        greeting: `Xin chào ${user.displayName || email},`,
        description: 'WeaHR đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
        actionLabel: 'Đặt lại mật khẩu',
        actionUrl: link,
      });
      return accepted();
    } catch (error) {
      if (error?.code === 'auth/user-not-found' || error?.code === 'cooldown') {
        await sleep(200);
        return accepted();
      }
      console.error('password-reset failed', { code: error?.code, message: error?.message });
      // Do not reveal delivery or account existence details.
      return accepted();
    }
  });

  app.use('/v1/attendance', createAttendanceRouter({ auth, firestore }));

  app.use((_request, response) => errorResponse(response, 404, 'not-found', 'Không tìm thấy API.'));
  return app;
};
