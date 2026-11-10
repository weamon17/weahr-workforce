import crypto from 'node:crypto';
import express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ORDER_TTL_MS,
  buildVietQrPayload,
  createOrderCode,
  extractOrderCode,
  nextPeriodEnd,
  quoteOrder,
} from './billingLogic.js';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bearerToken = request => String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';

const secretEquals = (left, right) => {
  const leftHash = crypto.createHash('sha256').update(String(left || '')).digest();
  const rightHash = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
};

const route = handler => async (request, response) => {
  try {
    response.json({ ok: true, ...(await handler(request)) });
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error('billing route failed', { code: error?.code, message: error?.message });
    response.status(known ? error.status : 500).json({
      ok: false,
      error: {
        code: known ? error.code : 'billing-api-error',
        message: known ? error.message : 'Dịch vụ thanh toán không phản hồi.',
      },
    });
  }
};

export const isBillingConfigured = billing => Boolean(
  billing?.bankBin && billing?.accountNumber && billing?.webhookApiKey,
);

// `billing` holds the receiving bank account and the SePay webhook API key.
export const createBillingRouter = ({
  auth,
  firestore,
  billing,
  randomBytes = crypto.randomBytes,
  now = () => new Date(),
}) => {
  const router = express.Router();

  const requireOwner = async request => {
    const token = bearerToken(request);
    if (!token) throw new ApiError(401, 'unauthenticated', 'Thiếu Firebase ID token.');
    let decoded;
    try {
      decoded = await auth.verifyIdToken(token, true);
    } catch {
      throw new ApiError(401, 'unauthenticated', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    const snapshot = await firestore.collection('users').doc(decoded.uid).get();
    const user = snapshot.data();
    if (!snapshot.exists || user?.status !== 'active' || user.role !== 'manager' || !user.organizationId) {
      throw new ApiError(403, 'manager-required', 'Chỉ quản lý được phép thanh toán.');
    }
    if (user.isOrganizationOwner !== true) {
      throw new ApiError(403, 'owner-required', 'Chỉ chủ quán được phép mua hoặc gia hạn gói.');
    }
    return { uid: decoded.uid, ...user };
  };

  // Creates a payment order and returns everything the owner needs to pay it.
  router.post('/orders', route(async request => {
    if (!isBillingConfigured(billing)) {
      throw new ApiError(503, 'billing-not-configured', 'Thanh toán chưa được cấu hình trên máy chủ.');
    }
    const owner = await requireOwner(request);
    const quote = quoteOrder(request.body?.plan, request.body?.cycle);
    if (!quote) throw new ApiError(400, 'invalid-plan', 'Gói hoặc chu kỳ thanh toán không hợp lệ.');

    const issuedAt = now();
    const code = createOrderCode(randomBytes);
    const expiresAt = new Date(issuedAt.getTime() + ORDER_TTL_MS);
    await firestore.collection('billing_orders').doc(code).set({
      code,
      organizationId: owner.organizationId,
      plan: quote.plan,
      cycle: quote.cycle,
      months: quote.months,
      amount: quote.amount,
      status: 'pending',
      createdBy: owner.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    });

    return {
      order: { code, plan: quote.plan, cycle: quote.cycle, amount: quote.amount, expiresAt: expiresAt.getTime() },
      payment: {
        bankName: billing.bankName || '',
        bankBin: billing.bankBin,
        accountNumber: billing.accountNumber,
        accountName: billing.accountName || '',
        memo: code,
        qrPayload: buildVietQrPayload({
          bankBin: billing.bankBin,
          accountNumber: billing.accountNumber,
          amount: quote.amount,
          memo: code,
        }),
      },
    };
  }));

  // SePay calls this for every movement on the receiving account.
  // Payload: { id, gateway, transactionDate, accountNumber, content,
  //            transferType: 'in' | 'out', transferAmount, referenceCode, ... }
  router.post('/webhooks/sepay', async (request, response) => {
    const header = String(request.headers.authorization || '');
    const providedKey = header.match(/^Apikey\s+(.+)$/i)?.[1] || '';
    if (!billing?.webhookApiKey || !secretEquals(providedKey, billing.webhookApiKey)) {
      return response.status(401).json({ success: false, message: 'Invalid API key' });
    }

    const body = request.body || {};
    const transactionId = String(body.id ?? '').trim();
    const amount = Number(body.transferAmount);
    if (!transactionId || !Number.isFinite(amount)) {
      return response.status(400).json({ success: false, message: 'Invalid payload' });
    }
    if (body.transferType !== 'in') return response.json({ success: true, result: 'ignored' });
    if (billing.accountNumber && body.accountNumber && String(body.accountNumber) !== String(billing.accountNumber)) {
      return response.json({ success: true, result: 'ignored' });
    }

    const code = extractOrderCode(`${body.code || ''} ${body.content || ''} ${body.description || ''}`);
    const transactionRef = firestore.collection('billing_transactions').doc(`sepay_${transactionId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    const receivedAt = now();
    const record = {
      provider: 'sepay',
      providerTransactionId: transactionId,
      orderCode: code,
      amount,
      gateway: String(body.gateway || '').slice(0, 80),
      referenceCode: String(body.referenceCode || '').slice(0, 120),
      content: String(body.content || '').slice(0, 500),
      receivedAt: Timestamp.fromDate(receivedAt),
    };

    try {
      const result = await firestore.runTransaction(async transaction => {
        const existing = await transaction.get(transactionRef);
        if (existing.exists) return 'duplicate';

        const orderRef = code ? firestore.collection('billing_orders').doc(code) : null;
        const orderSnap = orderRef ? await transaction.get(orderRef) : null;
        const order = orderSnap?.exists ? orderSnap.data() : null;
        if (!order) {
          transaction.set(transactionRef, { ...record, result: 'unmatched' });
          return 'unmatched';
        }
        if (order.status === 'paid') {
          transaction.set(transactionRef, { ...record, organizationId: order.organizationId, result: 'already_paid' });
          return 'already_paid';
        }
        if (amount < order.amount) {
          transaction.set(transactionRef, { ...record, organizationId: order.organizationId, result: 'underpaid' });
          transaction.update(orderRef, { status: 'underpaid', paidAmount: amount, updatedAt: FieldValue.serverTimestamp() });
          return 'underpaid';
        }

        const organizationRef = firestore.collection('organizations').doc(order.organizationId);
        const organizationSnap = await transaction.get(organizationRef);
        if (!organizationSnap.exists) {
          transaction.set(transactionRef, { ...record, organizationId: order.organizationId, result: 'organization_missing' });
          return 'organization_missing';
        }
        const organization = organizationSnap.data();
        const quote = quoteOrder(order.plan, order.cycle);
        const currentEnd = organization.subscriptionStatus === 'active'
          ? organization.currentPeriodEnd?.toDate?.() || null
          : null;
        const periodEnd = nextPeriodEnd({ currentPeriodEnd: currentEnd, now: receivedAt, months: order.months });

        transaction.update(organizationRef, {
          plan: order.plan,
          billingCycle: order.cycle,
          subscriptionStatus: 'active',
          currentPeriodEnd: Timestamp.fromDate(periodEnd),
          limits: quote?.limits || organization.limits || {},
          lastPaymentAt: Timestamp.fromDate(receivedAt),
          lastOrderCode: order.code,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(orderRef, {
          status: 'paid',
          paidAmount: amount,
          paidAt: Timestamp.fromDate(receivedAt),
          periodEnd: Timestamp.fromDate(periodEnd),
          providerTransactionId: transactionId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(transactionRef, { ...record, organizationId: order.organizationId, result: 'applied' });
        return 'applied';
      });
      return response.json({ success: true, result });
    } catch (error) {
      console.error('sepay webhook failed', { code: error?.code, message: error?.message });
      // A non-2xx answer makes SePay retry, which is safe thanks to idempotency.
      return response.status(500).json({ success: false, message: 'Temporary failure' });
    }
  });

  return router;
};
