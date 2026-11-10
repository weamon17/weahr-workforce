// Billing rules shared by the backend (source of truth for amounts) and the
// web app (display only). Pure functions: no Node or browser APIs.

export const PLAN_IDS = ['starter', 'standard', 'chain'];

// Monthly prices in VND. Change them here only; the web app imports this file.
export const PLANS = Object.freeze({
  starter: Object.freeze({
    id: 'starter',
    monthlyPrice: 149000,
    limits: Object.freeze({ branches: 1, employees: 10, managers: 1 }),
  }),
  standard: Object.freeze({
    id: 'standard',
    monthlyPrice: 299000,
    limits: Object.freeze({ branches: 2, employees: 30, managers: 3 }),
    recommended: true,
  }),
  chain: Object.freeze({
    id: 'chain',
    monthlyPrice: 699000,
    limits: Object.freeze({ branches: 10, employees: 150, managers: 15 }),
  }),
});

// Paying yearly costs 10 months: two months free.
export const BILLING_CYCLES = Object.freeze({
  monthly: Object.freeze({ id: 'monthly', months: 1, billedMonths: 1 }),
  yearly: Object.freeze({ id: 'yearly', months: 12, billedMonths: 10 }),
});

export const ORDER_PREFIX = 'WEA';
// No I, O, 0 or 1 so a code read aloud or typed by hand is unambiguous.
export const ORDER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ORDER_CODE_LENGTH = 8;
export const ORDER_TTL_MS = 48 * 60 * 60 * 1000;
export const RENEWAL_WARNING_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export const quoteOrder = (planId, cycleId) => {
  const plan = PLANS[planId];
  const cycle = BILLING_CYCLES[cycleId];
  if (!plan || !cycle) return null;
  return {
    plan: plan.id,
    cycle: cycle.id,
    months: cycle.months,
    amount: plan.monthlyPrice * cycle.billedMonths,
    limits: { ...plan.limits },
  };
};

// `randomBytes` returns an array-like of random byte values (crypto in Node).
export const createOrderCode = randomBytes => {
  const bytes = randomBytes(ORDER_CODE_LENGTH);
  let code = ORDER_PREFIX;
  for (let index = 0; index < ORDER_CODE_LENGTH; index += 1) {
    code += ORDER_ALPHABET[bytes[index] % ORDER_ALPHABET.length];
  }
  return code;
};

const ORDER_CODE_PATTERN = new RegExp(`${ORDER_PREFIX}[${ORDER_ALPHABET}]{${ORDER_CODE_LENGTH}}`);

// Banks may upper-case the memo, add prefixes or insert separators, so the
// code is searched for after stripping everything but letters and digits.
export const extractOrderCode = content => {
  const compact = String(content || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.match(ORDER_CODE_PATTERN)?.[0] || null;
};

export const addMonths = (date, months) => {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  // 31 Jan + 1 month must not roll into March.
  if (next.getUTCDate() < day) next.setUTCDate(0);
  return next;
};

// Paying early extends the current period instead of discarding unused days.
export const nextPeriodEnd = ({ currentPeriodEnd, now, months }) => {
  const base = currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime() ? currentPeriodEnd : now;
  return addMonths(base, months);
};

// ── VietQR (NAPAS EMVCo) ──────────────────────────────────────────────────

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

export const crc16Ccitt = text => {
  let crc = 0xffff;
  for (let index = 0; index < text.length; index += 1) {
    crc ^= text.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

// Builds the string encoded in a VietQR bank-transfer code. Every Vietnamese
// banking app reads it and pre-fills account, amount and transfer memo.
export const buildVietQrPayload = ({ bankBin, accountNumber, amount, memo }) => {
  const beneficiary = tlv('00', String(bankBin)) + tlv('01', String(accountNumber));
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  const body = tlv('00', '01')
    + tlv('01', '12')
    + tlv('38', merchant)
    + tlv('53', '704')
    + tlv('54', String(Math.round(amount)))
    + tlv('58', 'VN')
    + tlv('62', tlv('08', String(memo)))
    + '6304';
  return body + crc16Ccitt(body);
};

// ── Subscription state for banners and the billing screen ────────────────

const toDate = value => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getSubscriptionState = (organization, now = new Date()) => {
  if (!organization) return null;
  const daysUntil = date => Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
  if (organization.subscriptionStatus === 'active') {
    const endsAt = toDate(organization.currentPeriodEnd);
    if (!endsAt) return { state: 'active', plan: organization.plan, endsAt: null, daysLeft: null };
    const daysLeft = daysUntil(endsAt);
    if (daysLeft <= 0) return { state: 'lapsed', plan: organization.plan, endsAt, daysLeft: 0 };
    return {
      state: daysLeft <= RENEWAL_WARNING_DAYS ? 'renew_soon' : 'active',
      plan: organization.plan,
      endsAt,
      daysLeft,
    };
  }
  if (organization.subscriptionStatus === 'trialing') {
    const endsAt = toDate(organization.trialEndsAt);
    if (!endsAt) return null;
    const daysLeft = daysUntil(endsAt);
    return daysLeft <= 0
      ? { state: 'trial_expired', plan: 'trial', endsAt, daysLeft: 0 }
      : { state: 'trialing', plan: 'trial', endsAt, daysLeft };
  }
  return null;
};
