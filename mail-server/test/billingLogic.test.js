import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_CYCLES,
  PLANS,
  addMonths,
  buildVietQrPayload,
  crc16Ccitt,
  createOrderCode,
  extractOrderCode,
  getSubscriptionState,
  nextPeriodEnd,
  quoteOrder,
} from '../src/billingLogic.js';

// Splits an EMVCo string into { id: value } pairs, recursing where asked.
const parseTlv = text => {
  const fields = {};
  let index = 0;
  while (index < text.length) {
    const id = text.slice(index, index + 2);
    const length = Number(text.slice(index + 2, index + 4));
    fields[id] = text.slice(index + 4, index + 4 + length);
    index += 4 + length;
  }
  return fields;
};

test('yearly billing charges ten months for twelve', () => {
  const monthly = quoteOrder('standard', 'monthly');
  const yearly = quoteOrder('standard', 'yearly');
  assert.equal(monthly.amount, PLANS.standard.monthlyPrice);
  assert.equal(yearly.amount, PLANS.standard.monthlyPrice * 10);
  assert.equal(yearly.months, 12);
  assert.deepEqual(yearly.limits, PLANS.standard.limits);
  assert.equal(quoteOrder('enterprise', 'monthly'), null);
  assert.equal(quoteOrder('standard', 'weekly'), null);
  assert.ok(Object.values(BILLING_CYCLES).every(cycle => cycle.billedMonths <= cycle.months));
});

test('order codes are prefixed, fixed length and unambiguous', () => {
  const code = createOrderCode(length => Array.from({ length }, (_, index) => index * 37));
  assert.match(code, /^WEA[A-HJ-NP-Z2-9]{8}$/);
});

test('order codes are found in bank memos however the bank reformats them', () => {
  assert.equal(extractOrderCode('WEAK7P2QXM9'), 'WEAK7P2QXM9');
  assert.equal(extractOrderCode('MBVCB.123 weak7p2qxm9 chuyen tien'), 'WEAK7P2QXM9');
  assert.equal(extractOrderCode('IBFT WEA-K7P2-QXM9 FT2611'), 'WEAK7P2QXM9');
  assert.equal(extractOrderCode('thanh toan cafe'), null);
  assert.equal(extractOrderCode(''), null);
});

test('periods extend from the later of now and the current end', () => {
  const now = new Date('2026-11-11T03:00:00Z');
  assert.equal(nextPeriodEnd({ currentPeriodEnd: null, now, months: 1 }).toISOString(), '2026-12-11T03:00:00.000Z');
  const later = new Date('2026-11-20T00:00:00Z');
  assert.equal(nextPeriodEnd({ currentPeriodEnd: later, now, months: 1 }).toISOString(), '2026-12-20T00:00:00.000Z');
  const lapsed = new Date('2026-10-01T00:00:00Z');
  assert.equal(nextPeriodEnd({ currentPeriodEnd: lapsed, now, months: 12 }).toISOString(), '2027-11-11T03:00:00.000Z');
  assert.equal(addMonths(new Date('2027-01-31T00:00:00Z'), 1).toISOString(), '2027-02-28T00:00:00.000Z');
});

test('CRC matches the CCITT-FALSE reference value', () => {
  assert.equal(crc16Ccitt('123456789'), '29B1');
});

test('VietQR payload carries bank, account, amount and memo with a valid checksum', () => {
  const payload = buildVietQrPayload({ bankBin: '970422', accountNumber: '0123456789', amount: 399000, memo: 'WEAK7P2QXM9' });
  const fields = parseTlv(payload);
  assert.equal(fields['00'], '01');
  assert.equal(fields['01'], '12');
  assert.equal(fields['53'], '704');
  assert.equal(fields['54'], '399000');
  assert.equal(fields['58'], 'VN');
  assert.equal(parseTlv(fields['62'])['08'], 'WEAK7P2QXM9');
  const merchant = parseTlv(fields['38']);
  assert.equal(merchant['00'], 'A000000727');
  assert.equal(merchant['02'], 'QRIBFTTA');
  assert.deepEqual(parseTlv(merchant['01']), { '00': '970422', '01': '0123456789' });
  assert.equal(payload.slice(-4), crc16Ccitt(payload.slice(0, -4)));
});

test('subscription state covers trial, active, renewal and lapse', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  const days = count => new Date(now.getTime() + count * 86400000);
  assert.equal(getSubscriptionState({ subscriptionStatus: 'trialing', trialEndsAt: days(9) }, now).state, 'trialing');
  assert.equal(getSubscriptionState({ subscriptionStatus: 'trialing', trialEndsAt: days(-1) }, now).state, 'trial_expired');
  assert.equal(getSubscriptionState({ subscriptionStatus: 'active', plan: 'standard', currentPeriodEnd: days(20) }, now).state, 'active');
  assert.equal(getSubscriptionState({ subscriptionStatus: 'active', plan: 'standard', currentPeriodEnd: days(3) }, now).state, 'renew_soon');
  assert.equal(getSubscriptionState({ subscriptionStatus: 'active', plan: 'standard', currentPeriodEnd: days(-2) }, now).state, 'lapsed');
  assert.equal(getSubscriptionState({ subscriptionStatus: 'demo' }, now), null);
  assert.equal(getSubscriptionState(null, now), null);
});
