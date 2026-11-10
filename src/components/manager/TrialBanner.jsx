import React from 'react';
import { useTranslation } from 'react-i18next';
import { getSubscriptionState } from '../../utils/billing';
import { TRIAL_WARNING_DAYS } from '../../utils/trial';

const TONES = {
  trialing: { background: '#f6ece2', color: '#552d17', icon: 'fas fa-gift' },
  trial_ending: { background: '#fdf1d8', color: '#7a4f08', icon: 'fas fa-hourglass-half' },
  trial_expired: { background: '#fbe9e6', color: '#8a251c', icon: 'fas fa-circle-exclamation' },
  renew_soon: { background: '#fdf1d8', color: '#7a4f08', icon: 'fas fa-hourglass-half' },
  lapsed: { background: '#fbe9e6', color: '#8a251c', icon: 'fas fa-circle-exclamation' },
};

// Plan reminder above every manager screen. A paid shop in good standing sees nothing.
export default function TrialBanner({ organization, onUpgrade }) {
  const { t, i18n } = useTranslation();
  const status = getSubscriptionState(organization);
  if (!status || status.state === 'active') return null;

  const key = status.state === 'trialing' && status.daysLeft <= TRIAL_WARNING_DAYS ? 'trial_ending' : status.state;
  const tone = TONES[key];
  const date = status.endsAt.toLocaleDateString(i18n.language === 'vi' ? 'vi-VN' : 'en-US');
  const message = t(`trial.banner_${key}`, { count: status.daysLeft, date });
  const action = key.startsWith('trial') ? t('trial.see_plans') : t('trial.renew_now');

  return (
    <div role="status" className="trial-banner" style={{ background: tone.background, color: tone.color }}>
      <span><i className={tone.icon} aria-hidden="true"></i> {message}</span>
      {onUpgrade && (
        <button type="button" className="trial-banner-action" onClick={onUpgrade} style={{ color: tone.color }}>
          {action} <i className="fas fa-arrow-right" aria-hidden="true"></i>
        </button>
      )}
    </div>
  );
}
