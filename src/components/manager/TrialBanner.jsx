import React from 'react';
import { useTranslation } from 'react-i18next';
import { getTrialStatus } from '../../utils/trial';

const SALES_EMAIL = 'weahr0426@gmail.com';

const TONES = {
  trialing: { background: '#eef2ff', color: '#3730a3', icon: 'fas fa-gift' },
  ending: { background: '#fffbeb', color: '#92400e', icon: 'fas fa-hourglass-half' },
  expired: { background: '#fef2f2', color: '#991b1b', icon: 'fas fa-exclamation-circle' },
};

export default function TrialBanner({ organization }) {
  const { t, i18n } = useTranslation();
  const status = getTrialStatus(organization);
  if (!status) return null;
  const tone = TONES[status.state];
  const endDate = status.endsAt.toLocaleDateString(i18n.language === 'vi' ? 'vi-VN' : 'en-US');
  const message = status.state === 'expired'
    ? t('trial.expired', { date: endDate })
    : t('trial.days_left', { count: status.daysLeft, date: endDate });
  const subject = encodeURIComponent(t('trial.upgrade_subject', { name: organization.name || '' }));

  return (
    <div role="status" className="trial-banner" style={{ background: tone.background, color: tone.color }}>
      <span><i className={tone.icon} aria-hidden="true"></i> {message}</span>
      {status.state !== 'trialing' && (
        <a href={`mailto:${SALES_EMAIL}?subject=${subject}`} style={{ color: tone.color }}>
          {t('trial.contact_upgrade')}
        </a>
      )}
    </div>
  );
}
