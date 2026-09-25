import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

const createFirestore = () => ({
  collection: () => ({
    doc: () => ({}),
  }),
  runTransaction: async callback => callback({
    get: async () => ({ data: () => null }),
    set: () => {},
  }),
});

const start = async dependencies => {
  const server = createApp(dependencies).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    url: `http://127.0.0.1:${port}`,
  };
};

test('health endpoint does not expose secrets', async t => {
  const { server, url } = await start({
    auth: {},
    firestore: createFirestore(),
    sendMail: async () => {},
  });
  t.after(() => server.close());
  const response = await fetch(`${url}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, service: 'weahr-mail-server' });
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('verification endpoint requires Firebase ID token', async t => {
  const { server, url } = await start({
    auth: {},
    firestore: createFirestore(),
    sendMail: async () => {},
  });
  t.after(() => server.close());
  const response = await fetch(`${url}/v1/auth/verification-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'unauthenticated');
});

test('attendance QR endpoint requires Firebase ID token', async t => {
  const { server, url } = await start({
    auth: {},
    firestore: createFirestore(),
    sendMail: async () => {},
  });
  t.after(() => server.close());
  const response = await fetch(`${url}/v1/attendance/qr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'unauthenticated');
});

test('verification email can only target the authenticated token email', async t => {
  let delivered;
  const auth = {
    verifyIdToken: async () => ({ uid: 'user-1', email: 'owner@example.com', email_verified: false }),
    getUser: async () => ({ uid: 'user-1', email: 'owner@example.com', emailVerified: false, displayName: 'Owner' }),
    generateEmailVerificationLink: async email => `https://verify.example.test/?email=${encodeURIComponent(email)}`,
  };
  const { server, url } = await start({
    auth,
    firestore: createFirestore(),
    sendMail: async message => { delivered = message; },
  });
  t.after(() => server.close());
  const response = await fetch(`${url}/v1/auth/verification-email`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: 'attacker@example.com' }),
  });
  assert.equal(response.status, 200);
  assert.equal(delivered.to, 'owner@example.com');
  assert.match(delivered.actionUrl, /owner%40example\.com/);
});

test('password reset always returns a non-enumerating response', async t => {
  const auth = {
    getUserByEmail: async () => {
      const error = new Error('missing');
      error.code = 'auth/user-not-found';
      throw error;
    },
  };
  const { server, url } = await start({
    auth,
    firestore: createFirestore(),
    sendMail: async () => assert.fail('must not send'),
  });
  t.after(() => server.close());
  const response = await fetch(`${url}/v1/auth/password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.com' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.accepted, true);
});
