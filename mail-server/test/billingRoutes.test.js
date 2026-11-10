import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Timestamp } from 'firebase-admin/firestore';
import { createApp } from '../src/app.js';
import { PLANS } from '../src/billingLogic.js';
import { createFirestore } from './support/fakeFirestore.js';

const BILLING = {
  bankName: 'MB Bank',
  bankBin: '970422',
  accountNumber: '0123456789',
  accountName: 'CONG TY WEAHR',
  webhookApiKey: 'test-webhook-key',
};

const owner = { role: 'manager', status: 'active', organizationId: 'org-a', isOrganizationOwner: true };
const seed = () => ({
  'users/owner-a': owner,
  'users/manager-a': { ...owner, isOrganizationOwner: false },
  'users/employee-a': { role: 'employee', status: 'active', organizationId: 'org-a' },
  'organizations/org-a': {
    organizationId: 'org-a',
    plan: 'trial',
    subscriptionStatus: 'trialing',
    limits: { branches: 2, employees: 30, managers: 3 },
  },
});

const auth = { verifyIdToken: async token => ({ uid: token }) };

const start = async (firestore, billing = BILLING) => {
  const app = createApp({ auth, firestore, sendMail: async () => {}, billing });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

const post = (url, path, body, headers = {}) => fetch(`${url}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const createOrder = async (url, uid, body = { plan: 'standard', cycle: 'monthly' }) => {
  const response = await post(url, '/v1/billing/orders', body, { authorization: `Bearer ${uid}` });
  return { response, body: await response.json() };
};

const sepay = (url, payload, key = BILLING.webhookApiKey) => post(url, '/v1/billing/webhooks/sepay', {
  id: 1001,
  gateway: 'MBBank',
  transactionDate: '2026-11-11 10:00:00',
  accountNumber: BILLING.accountNumber,
  transferType: 'in',
  referenceCode: 'FT26315',
  ...payload,
}, { authorization: `Apikey ${key}` });

test('only the shop owner can create a payment order', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());

  assert.equal((await createOrder(url, 'employee-a')).response.status, 403);
  const manager = await createOrder(url, 'manager-a');
  assert.equal(manager.response.status, 403);
  assert.equal(manager.body.error.code, 'owner-required');

  const { response, body } = await createOrder(url, 'owner-a');
  assert.equal(response.status, 200);
  assert.match(body.order.code, /^WEA[A-Z2-9]{8}$/);
  assert.equal(body.order.amount, PLANS.standard.monthlyPrice);
  assert.equal(body.payment.memo, body.order.code);
  assert.equal(body.payment.accountNumber, BILLING.accountNumber);
  assert.ok(body.payment.qrPayload.includes(body.order.code));
  const stored = firestore.store.get(`billing_orders/${body.order.code}`);
  assert.equal(stored.organizationId, 'org-a');
  assert.equal(stored.status, 'pending');
});

test('the client cannot choose the price or an unknown plan', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const cheap = await createOrder(url, 'owner-a', { plan: 'chain', cycle: 'yearly', amount: 1000 });
  assert.equal(cheap.body.order.amount, PLANS.chain.monthlyPrice * 10);
  assert.equal((await createOrder(url, 'owner-a', { plan: 'vip', cycle: 'monthly' })).response.status, 400);
});

test('orders are refused until billing is configured', async t => {
  const { server, url } = await start(createFirestore(seed()), { ...BILLING, webhookApiKey: '' });
  t.after(() => server.close());
  const { response, body } = await createOrder(url, 'owner-a');
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'billing-not-configured');
});

test('webhook rejects a wrong API key', async t => {
  const { server, url } = await start(createFirestore(seed()));
  t.after(() => server.close());
  const response = await sepay(url, { content: 'x', transferAmount: 1 }, 'wrong');
  assert.equal(response.status, 401);
});

test('a matching bank transfer activates the plan once', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const { body } = await createOrder(url, 'owner-a');
  const code = body.order.code;

  const first = await sepay(url, { content: `MBVCB.555 ${code.toLowerCase()} thanh toan`, transferAmount: body.order.amount });
  assert.deepEqual(await first.json(), { success: true, result: 'applied' });

  const organization = firestore.store.get('organizations/org-a');
  assert.equal(organization.subscriptionStatus, 'active');
  assert.equal(organization.plan, 'standard');
  assert.equal(organization.billingCycle, 'monthly');
  assert.deepEqual(organization.limits, PLANS.standard.limits);
  const end = organization.currentPeriodEnd.toDate();
  const days = (end.getTime() - Date.now()) / 86400000;
  assert.ok(days > 27 && days < 32, `period should be about a month, got ${days}`);
  assert.equal(firestore.store.get(`billing_orders/${code}`).status, 'paid');

  const retry = await sepay(url, { content: code, transferAmount: body.order.amount });
  assert.equal((await retry.json()).result, 'duplicate');
  assert.equal(firestore.store.get('organizations/org-a').currentPeriodEnd.toMillis(), organization.currentPeriodEnd.toMillis());
});

test('renewing early extends the current period', async t => {
  const currentEnd = new Date(Date.now() + 10 * 86400000);
  const firestore = createFirestore({
    ...seed(),
    'organizations/org-a': {
      organizationId: 'org-a', plan: 'standard', subscriptionStatus: 'active',
      currentPeriodEnd: Timestamp.fromDate(currentEnd), limits: PLANS.standard.limits,
    },
  });
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const { body } = await createOrder(url, 'owner-a');
  await sepay(url, { id: 2002, content: body.order.code, transferAmount: body.order.amount });
  const end = firestore.store.get('organizations/org-a').currentPeriodEnd.toDate();
  const days = (end.getTime() - Date.now()) / 86400000;
  assert.ok(days > 37 && days < 42, `expected ~40 days, got ${days}`);
});

test('underpaid, unmatched and outgoing transfers never activate a plan', async t => {
  const firestore = createFirestore(seed());
  const { server, url } = await start(firestore);
  t.after(() => server.close());
  const { body } = await createOrder(url, 'owner-a');

  const outgoing = await sepay(url, { id: 3001, transferType: 'out', content: body.order.code, transferAmount: body.order.amount });
  assert.equal((await outgoing.json()).result, 'ignored');

  const unknown = await sepay(url, { id: 3002, content: 'chuyen tien cafe', transferAmount: 500000 });
  assert.equal((await unknown.json()).result, 'unmatched');
  assert.equal(firestore.store.get('billing_transactions/sepay_3002').result, 'unmatched');

  const underpaid = await sepay(url, { id: 3003, content: body.order.code, transferAmount: body.order.amount - 1000 });
  assert.equal((await underpaid.json()).result, 'underpaid');
  assert.equal(firestore.store.get(`billing_orders/${body.order.code}`).status, 'underpaid');
  assert.equal(firestore.store.get('organizations/org-a').subscriptionStatus, 'trialing');
});
