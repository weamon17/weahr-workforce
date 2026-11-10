import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { BILLING_CYCLES, PLAN_IDS, PLANS, getSubscriptionState, quoteOrder } from '../../utils/billing';
import { createBillingOrder } from '../../services/billingApi';

const money = value => new Intl.NumberFormat('vi-VN').format(value) + ' ₫';

const STATE_TONE = {
  trialing: 'info',
  trial_expired: 'danger',
  active: 'success',
  renew_soon: 'warning',
  lapsed: 'danger',
};

function CopyRow({ label, value, display, onCopy }) {
  return (
    <div className="pay-row">
      <span className="pay-row-label">{label}</span>
      <span className="pay-row-value">{display || value}</span>
      <button type="button" className="pay-copy" onClick={() => onCopy(String(value))} aria-label={`${label}: copy`}>
        <i className="fas fa-copy" aria-hidden="true"></i>
      </button>
    </div>
  );
}

function PlanCard({ planId, cycle, current, disabled, busy, onChoose }) {
  const { t } = useTranslation();
  const plan = PLANS[planId];
  const quote = quoteOrder(planId, cycle);
  const perMonth = Math.round(quote.amount / quote.months);
  return (
    <article className={`plan-card ${plan.recommended ? 'is-recommended' : ''} ${current ? 'is-current' : ''}`}>
      {plan.recommended && <span className="plan-ribbon">{t('billing.recommended')}</span>}
      <h4>{t(`billing.plan_${planId}`)}</h4>
      <p className="plan-for">{t(`billing.plan_${planId}_for`)}</p>
      <div className="plan-price">
        <strong>{money(perMonth)}</strong>
        <span>{t('billing.per_month')}</span>
      </div>
      <p className="plan-billed">
        {cycle === 'yearly' ? t('billing.billed_yearly', { amount: money(quote.amount) }) : t('billing.billed_monthly')}
      </p>
      <ul className="plan-limits">
        <li><i className="fas fa-check" aria-hidden="true"></i> {t('billing.limit_employees', { count: plan.limits.employees })}</li>
        <li><i className="fas fa-check" aria-hidden="true"></i> {t('billing.limit_branches', { count: plan.limits.branches })}</li>
        <li><i className="fas fa-check" aria-hidden="true"></i> {t('billing.limit_managers', { count: plan.limits.managers })}</li>
        <li><i className="fas fa-check" aria-hidden="true"></i> {t('billing.all_features')}</li>
      </ul>
      <button type="button" className={plan.recommended ? 'btn-primary' : 'btn-secondary'} disabled={disabled || busy} onClick={() => onChoose(planId)}>
        {busy ? t('billing.creating_order') : current ? t('billing.renew') : t('billing.choose')}
      </button>
    </article>
  );
}

function Checkout({ db, checkout, onBack, onCopy }) {
  const { t, i18n } = useTranslation();
  const { order, payment } = checkout;
  const [qrImage, setQrImage] = useState('');
  const [liveOrder, setLiveOrder] = useState(null);

  useEffect(() => {
    let cancelled = false;
    import('qrcode').then(async module => {
      const QRCode = module.default || module;
      const image = await QRCode.toDataURL(payment.qrPayload, { width: 320, margin: 1, color: { dark: '#2b1a12', light: '#ffffff' } });
      if (!cancelled) setQrImage(image);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [payment.qrPayload]);

  useEffect(() => onSnapshot(
    doc(db, 'billing_orders', order.code),
    snapshot => setLiveOrder(snapshot.exists() ? snapshot.data() : null),
    () => {},
  ), [db, order.code]);

  const status = liveOrder?.status || 'pending';
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const periodEnd = liveOrder?.periodEnd?.toDate?.();

  if (status === 'paid') {
    return (
      <div className="checkout-result is-success" role="status">
        <i className="fas fa-circle-check" aria-hidden="true"></i>
        <h4>{t('billing.paid_title')}</h4>
        <p>{t('billing.paid_body', { plan: t(`billing.plan_${order.plan}`), date: periodEnd ? periodEnd.toLocaleDateString(locale) : '' })}</p>
        <button type="button" className="btn-primary" onClick={onBack}>{t('billing.done')}</button>
      </div>
    );
  }

  return (
    <div className="checkout">
      <div className="checkout-qr">
        {qrImage ? <img src={qrImage} alt={t('billing.qr_alt')} width="240" height="240" /> : <div className="spinner" />}
        <p>{t('billing.scan_hint')}</p>
      </div>
      <div className="checkout-info">
        <h4>{t('billing.checkout_title', { plan: t(`billing.plan_${order.plan}`), cycle: t(`billing.cycle_${order.cycle}`) })}</h4>
        <CopyRow label={t('billing.amount')} value={order.amount} display={money(order.amount)} onCopy={onCopy} />
        <CopyRow label={t('billing.memo')} value={payment.memo} onCopy={onCopy} />
        {payment.bankName && <div className="pay-row"><span className="pay-row-label">{t('billing.bank')}</span><span className="pay-row-value">{payment.bankName}</span></div>}
        <CopyRow label={t('billing.account_number')} value={payment.accountNumber} onCopy={onCopy} />
        {payment.accountName && <div className="pay-row"><span className="pay-row-label">{t('billing.account_name')}</span><span className="pay-row-value">{payment.accountName}</span></div>}
        <p className="checkout-warning"><i className="fas fa-triangle-exclamation" aria-hidden="true"></i> {t('billing.memo_warning', { memo: payment.memo })}</p>
        {status === 'underpaid' ? (
          <p className="checkout-status is-warning">
            <i className="fas fa-circle-exclamation" aria-hidden="true"></i>
            {t('billing.underpaid', { paid: money(liveOrder?.paidAmount || 0), amount: money(order.amount) })}
          </p>
        ) : (
          <p className="checkout-status"><span className="spinner spinner-sm" aria-hidden="true"></span>{t('billing.waiting')}</p>
        )}
        <button type="button" className="auth-link" onClick={onBack}>{t('billing.back_to_plans')}</button>
      </div>
    </div>
  );
}

export default function BillingPanel({ db, organization, isOwner, showToast }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const [cycle, setCycle] = useState('monthly');
  const [busyPlan, setBusyPlan] = useState('');
  const [checkout, setCheckout] = useState(null);
  const subscription = getSubscriptionState(organization);
  const currentPlan = subscription && ['active', 'renew_soon', 'lapsed'].includes(subscription.state) ? subscription.plan : null;

  const copy = async value => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(t('billing.copied'));
    } catch {
      showToast(t('org.copy_failed'), 'warning');
    }
  };

  const choose = async planId => {
    setBusyPlan(planId);
    try {
      setCheckout(await createBillingOrder(planId, cycle));
    } catch (error) {
      showToast(error.code === 'billing-not-configured' ? t('billing.not_configured') : error.message, 'error');
    } finally {
      setBusyPlan('');
    }
  };

  const statusText = () => {
    if (!subscription) return t('billing.status_none');
    const date = subscription.endsAt ? subscription.endsAt.toLocaleDateString(locale) : '';
    return t(`billing.status_${subscription.state}`, { count: subscription.daysLeft, date });
  };

  return (
    <section className="card billing-panel" id="billing" aria-labelledby="billing-title">
      <div className="billing-head">
        <div>
          <h3 id="billing-title"><i className="fas fa-receipt" aria-hidden="true"></i> {t('billing.title')}</h3>
          <p className="page-sub">{t('billing.subtitle')}</p>
        </div>
        <div className={`billing-status tone-${STATE_TONE[subscription?.state] || 'info'}`}>
          <small>{t('billing.current_plan')}</small>
          <strong>{currentPlan ? t(`billing.plan_${currentPlan}`) : t('billing.plan_trial')}</strong>
          <span>{statusText()}</span>
        </div>
      </div>

      {checkout ? (
        <Checkout db={db} checkout={checkout} onBack={() => setCheckout(null)} onCopy={copy} />
      ) : (
        <>
          <div className="billing-toolbar">
            <div className="segmented" role="group" aria-label={t('billing.cycle_label')}>
              {Object.keys(BILLING_CYCLES).map(id => (
                <button key={id} type="button" className={cycle === id ? 'active' : ''} aria-pressed={cycle === id} onClick={() => setCycle(id)}>
                  {t(`billing.cycle_${id}`)}
                </button>
              ))}
            </div>
            <span className="billing-save">{t('billing.yearly_saving')}</span>
          </div>
          {!isOwner && <p className="billing-note"><i className="fas fa-lock" aria-hidden="true"></i> {t('billing.owner_only')}</p>}
          <div className="plan-grid">
            {PLAN_IDS.map(planId => (
              <PlanCard
                key={planId}
                planId={planId}
                cycle={cycle}
                current={currentPlan === planId}
                disabled={!isOwner || Boolean(busyPlan)}
                busy={busyPlan === planId}
                onChoose={choose}
              />
            ))}
          </div>
          <p className="billing-note"><i className="fas fa-building-columns" aria-hidden="true"></i> {t('billing.how_it_works')}</p>
        </>
      )}
    </section>
  );
}
