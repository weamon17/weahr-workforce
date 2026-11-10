import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { describeChanges, hoursBetween, normalizeManualRecord, normalizeReason } from '../src/timesheetLogic.js';
import { createFirestore } from './support/fakeFirestore.js';

const seed = () => ({
  'users/manager-a': { role: 'manager', status: 'active', organizationId: 'org-a', fullName: 'Chủ quán A' },
  'users/manager-b': { role: 'manager', status: 'active', organizationId: 'org-b' },
  'users/employee-a': { role: 'employee', status: 'active', organizationId: 'org-a' },
  'users/employee-b': { role: 'employee', status: 'active', organizationId: 'org-b' },
  'timesheets/ts-1': {
    organizationId: 'org-a', employeeId: 'employee-a', employeeName: 'Nguyễn An', type: 'parttime',
    date: '2026-11-10', status: 'work', dayRate: 1, checkIn: '08:18', checkOut: '14:00', workHours: 5.7,
    otHours: 0, otCalculationMode: 'hourly', lateHours: 0.3, secureAttendance: true, checkInLatitude: 10.77,
  },
});

const auth = { verifyIdToken: async token => ({ uid: token }) };

const start = async firestore => {
  const server = createApp({ auth, firestore, sendMail: async () => {}, billing: {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

const post = async (url, path, uid, body = {}) => {
  const response = await fetch(`${url}/v1/timesheets${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${uid}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const edited = overrides => ({
  employeeId: 'employee-a', employeeName: 'Nguyễn An', type: 'parttime', date: '2026-11-10',
  status: 'work', dayRate: 1, checkIn: '08:00', checkOut: '14:00', otHours: 0, lateHours: 0, ...overrides,
});

const auditEntries = firestore => [...firestore.store.entries()]
  .filter(([path]) => path.startsWith('audit_logs/'))
  .map(([, data]) => data);

test('worked hours are computed by the server, including overnight shifts', () => {
  assert.equal(hoursBetween('08:00', '14:30'), 6.5);
  assert.equal(hoursBetween('22:00', '06:00'), 8);
  assert.equal(hoursBetween('', '06:00'), 0);
  const record = normalizeManualRecord(edited({ workHours: 99 }));
  assert.equal(record.workHours, 6);
  assert.equal(normalizeManualRecord(edited({ status: 'off', checkIn: '08:00' })).checkIn, '');
});

test('invalid manual records and missing reasons are rejected', () => {
  assert.throws(() => normalizeManualRecord(edited({ date: '2026-02-30' })), { code: 'invalid-date' });
  assert.throws(() => normalizeManualRecord(edited({ checkIn: '8h' })), { code: 'invalid-time' });
  assert.throws(() => normalizeManualRecord(edited({ checkOut: '' })), { code: 'missing-time' });
  assert.throws(() => normalizeManualRecord(edited({ otHours: 40 })), { code: 'invalid-number' });
  assert.throws(() => normalizeReason('ok'), { code: 'reason-required' });
  assert.equal(normalizeReason('', { required: false }), '');
});

test('changes are described field by field', () => {
  const changes = describeChanges({ checkIn: '08:18', lateHours: 0.3, otHours: 0 }, { checkIn: '08:00', lateHours: 0, otHours: 0 });
  assert.deepEqual(changes.map(change => change.field), ['checkIn', 'lateHours']);
  assert.deepEqual(changes[0], { field: 'checkIn', before: '08:18', after: '08:00' });
});

test('an edit and its audit entry are written together, with a required reason', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());

  const noReason = await post(url, '/ts-1/update', 'manager-a', { record: edited(), reason: '' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error.code, 'reason-required');
  assert.equal(auditEntries(firestore).length, 0);

  const saved = await post(url, '/ts-1/update', 'manager-a', { record: edited(), reason: 'Quên quẹt thẻ, camera xác nhận đến 8h' });
  assert.equal(saved.status, 200);
  const stored = firestore.store.get('timesheets/ts-1');
  assert.equal(stored.checkIn, '08:00');
  assert.equal(stored.workHours, 6);
  assert.equal(stored.editedManually, true);
  assert.equal(stored.secureAttendance, true, 'evidence fields from the QR check-in are kept');
  assert.equal(stored.checkInLatitude, 10.77);

  const [entry] = auditEntries(firestore);
  assert.equal(entry.type, 'timesheet_edit');
  assert.equal(entry.organizationId, 'org-a');
  assert.equal(entry.actorId, 'manager-a');
  assert.equal(entry.actorName, 'Chủ quán A');
  assert.equal(entry.before.checkIn, '08:18');
  assert.equal(entry.after.checkIn, '08:00');
  assert.ok(entry.changes.some(change => change.field === 'lateHours'));
});

test('an edit that changes nothing is not logged', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const same = edited({ checkIn: '08:18', lateHours: 0.3 });
  const result = await post(url, '/ts-1/update', 'manager-a', { record: { ...same, otCalculationMode: 'hourly', workHours: 5.7 }, reason: 'Kiểm tra lại' });
  assert.equal(result.body.unchanged, true);
  assert.equal(auditEntries(firestore).length, 0);
});

test('deleting keeps the full record in the audit log', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  assert.equal((await post(url, '/ts-1/delete', 'manager-a', { reason: 'x' })).status, 400);
  const deleted = await post(url, '/ts-1/delete', 'manager-a', { reason: 'Nhập trùng hai lần' });
  assert.equal(deleted.status, 200);
  assert.equal(firestore.store.has('timesheets/ts-1'), false);
  const [entry] = auditEntries(firestore);
  assert.equal(entry.type, 'timesheet_delete');
  assert.equal(entry.before.checkIn, '08:18');
  assert.equal(entry.reason, 'Nhập trùng hai lần');
});

test('creating a manual record is logged and scoped to the manager shop', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const created = await post(url, '/', 'manager-a', { record: { ...edited({ date: '2026-11-11' }), organizationId: 'org-b' } });
  assert.equal(created.status, 200);
  const stored = firestore.store.get(`timesheets/${created.body.record.id}`);
  assert.equal(stored.organizationId, 'org-a');
  assert.equal(stored.source, 'manual');
  assert.equal(auditEntries(firestore)[0].type, 'timesheet_create');
});

test('other shops, employees and foreign accounts are refused', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const reason = 'Lý do hợp lệ';
  assert.equal((await post(url, '/ts-1/update', 'manager-b', { record: edited(), reason })).status, 404);
  assert.equal((await post(url, '/ts-1/delete', 'manager-b', { reason })).status, 404);
  assert.equal((await post(url, '/ts-1/update', 'employee-a', { record: edited(), reason })).status, 403);
  assert.equal((await post(url, '/', null, { record: edited() })).status, 401);
  const foreign = await post(url, '/', 'manager-a', { record: edited({ employeeId: 'employee-b' }) });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error.code, 'employee-not-in-organization');
  assert.equal(firestore.store.get('timesheets/ts-1').checkIn, '08:18');
});

test('renaming an employee without an account updates their records and is logged', async t => {
  const firestore = createFirestore({
    ...seed(),
    'timesheets/ts-2': { organizationId: 'org-a', employeeId: null, employeeName: 'Bé Na', date: '2026-11-09' },
    'timesheets/ts-3': { organizationId: 'org-b', employeeId: null, employeeName: 'Bé Na', date: '2026-11-09' },
  });
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const renamed = await post(url, '/rename', 'manager-a', { fromName: 'Bé Na', toName: 'Trần Thị Na' });
  assert.equal(renamed.body.updated, 1);
  assert.equal(firestore.store.get('timesheets/ts-2').employeeName, 'Trần Thị Na');
  assert.equal(firestore.store.get('timesheets/ts-3').employeeName, 'Bé Na');
  assert.equal(auditEntries(firestore)[0].type, 'timesheet_rename');
});
