import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { QR_ROTATION_GRACE_MS, isQrTokenAccepted, qrDocumentId } from '../src/attendanceLogic.js';
import { createFirestore } from './support/fakeFirestore.js';

const seed = () => ({
  'users/manager-a': { role: 'manager', status: 'active', organizationId: 'org-a' },
  'users/manager-b': { role: 'manager', status: 'active', organizationId: 'org-b' },
  'users/employee-a': { role: 'employee', status: 'active', organizationId: 'org-a' },
  'organizations/org-a': { organizationId: 'org-a', name: 'Quán A' },
  'attendance_settings/org-a': { organizationId: 'org-a', latitude: 10.77, longitude: 106.7, qrTtlSeconds: 45 },
});

const auth = { verifyIdToken: async token => ({ uid: token }) };

const start = async firestore => {
  const server = createApp({ auth, firestore, sendMail: async () => {}, billing: {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

const post = async (url, path, { bearer, kiosk, body = {} } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (kiosk) headers.authorization = `Kiosk ${kiosk}`;
  const response = await fetch(`${url}/v1/attendance${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

test('a manager pairs a kiosk whose credential only shows the shop QR', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());

  assert.equal((await post(url, '/kiosks', { bearer: 'employee-a', body: { name: 'Quầy' } })).status, 403);
  const paired = await post(url, '/kiosks', { bearer: 'manager-a', body: { name: 'Quầy chính' } });
  assert.equal(paired.status, 200);
  assert.match(paired.body.credential, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const stored = firestore.store.get(`attendance_kiosks/${paired.body.kioskId}`);
  assert.equal(stored.organizationId, 'org-a');
  assert.ok(!JSON.stringify(stored).includes(paired.body.credential.split('.')[1]), 'secret must not be stored in plain text');

  const qr = await post(url, '/kiosk/qr', { kiosk: paired.body.credential });
  assert.equal(qr.status, 200);
  assert.equal(qr.body.shopName, 'Quán A');
  assert.equal(qr.body.kioskName, 'Quầy chính');
  const payload = JSON.parse(qr.body.qrPayload);
  assert.equal(payload.organizationId, 'org-a');
  assert.equal(payload.source, paired.body.kioskId);
  assert.equal(firestore.store.get(`attendance_qr/${qrDocumentId('org-a', paired.body.kioskId)}`).token, payload.token);
});

test('wrong, missing or revoked kiosk credentials are refused', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const { body } = await post(url, '/kiosks', { bearer: 'manager-a' });

  assert.equal((await post(url, '/kiosk/qr')).status, 401);
  assert.equal((await post(url, '/kiosk/qr', { kiosk: `${body.kioskId}.wrongsecret` })).status, 401);
  assert.equal((await post(url, '/kiosk/qr', { bearer: 'manager-a' })).status, 401);

  assert.equal((await post(url, `/kiosks/${body.kioskId}/revoke`, { bearer: 'manager-b' })).status, 404);
  assert.equal((await post(url, `/kiosks/${body.kioskId}/revoke`, { bearer: 'manager-a' })).status, 200);
  const revoked = await post(url, '/kiosk/qr', { kiosk: body.credential });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.body.error.code, 'kiosk-revoked');
});

test('the manager screen and each kiosk rotate separate QR tokens', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const first = await post(url, '/kiosks', { bearer: 'manager-a', body: { name: 'Quầy 1' } });
  const second = await post(url, '/kiosks', { bearer: 'manager-a', body: { name: 'Quầy 2' } });

  await post(url, '/kiosk/qr', { kiosk: first.body.credential });
  await post(url, '/kiosk/qr', { kiosk: second.body.credential });
  await post(url, '/qr', { bearer: 'manager-a' });

  const tokens = [
    firestore.store.get(`attendance_qr/${qrDocumentId('org-a', first.body.kioskId)}`)?.token,
    firestore.store.get(`attendance_qr/${qrDocumentId('org-a', second.body.kioskId)}`)?.token,
    firestore.store.get('attendance_qr/org-a')?.token,
  ];
  assert.ok(tokens.every(Boolean));
  assert.equal(new Set(tokens).size, 3);
});

test('a just-rotated token stays valid for a short grace period', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const { body } = await post(url, '/kiosks', { bearer: 'manager-a' });
  const before = JSON.parse((await post(url, '/kiosk/qr', { kiosk: body.credential })).body.qrPayload).token;
  await post(url, '/kiosk/qr', { kiosk: body.credential });
  const stored = firestore.store.get(`attendance_qr/${qrDocumentId('org-a', body.kioskId)}`);
  assert.equal(stored.previousToken, before);
  assert.ok(stored.previousValidUntil.toMillis() > Date.now());
});

test('token acceptance honours expiry and the rotation grace window', () => {
  const equals = (left, right) => left === right;
  const nowMs = 1_000_000;
  const qr = { token: 'new', expiresAtMs: nowMs + 30_000, previousToken: 'old', previousValidUntilMs: nowMs + QR_ROTATION_GRACE_MS };
  assert.equal(isQrTokenAccepted({ qr, token: 'new', nowMs, tokenEquals: equals }), true);
  assert.equal(isQrTokenAccepted({ qr, token: 'old', nowMs, tokenEquals: equals }), true);
  assert.equal(isQrTokenAccepted({ qr, token: 'old', nowMs: nowMs + QR_ROTATION_GRACE_MS + 1, tokenEquals: equals }), false);
  assert.equal(isQrTokenAccepted({ qr, token: 'new', nowMs: nowMs + 31_000, tokenEquals: equals }), false);
  assert.equal(isQrTokenAccepted({ qr, token: 'other', nowMs, tokenEquals: equals }), false);
  assert.equal(qrDocumentId('org-a'), 'org-a');
  assert.equal(qrDocumentId('org-a', 'k/../x'), 'org-a__kx');
});
