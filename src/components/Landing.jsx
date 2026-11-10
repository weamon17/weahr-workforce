import React from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo, BrandMark } from './brand/BrandLogo';
import './Landing.css';

const FEATURES = [
  { icon: 'fas fa-qrcode', key: 'attendance' },
  { icon: 'fas fa-calendar-week', key: 'schedule' },
  { icon: 'fas fa-wallet', key: 'payroll' },
  { icon: 'fas fa-chart-line', key: 'insights' },
];

const STEPS = ['workspace', 'invite', 'checkin'];

// Illustrative phone preview of the owner's "Today" screen.
function HeroPreview({ t }) {
  const people = [
    { name: t('landing.mock_person_1'), detail: t('landing.mock_in'), tone: 'working', status: t('landing.mock_working') },
    { name: t('landing.mock_person_2'), detail: t('landing.mock_late_tag'), tone: 'late', status: t('landing.mock_late') },
    { name: t('landing.mock_person_3'), detail: '06:55 – 13:02', tone: 'done', status: t('landing.mock_done') },
  ];
  return (
    <div className="landing-phone" aria-hidden="true">
      <div className="landing-phone-top">
        <BrandMark size={26} />
        <span>{t('landing.mock_title')}</span>
      </div>
      <div className="landing-phone-stats">
        <div className="tone-working"><strong>3</strong><span>{t('landing.mock_working')}</span></div>
        <div className="tone-late"><strong>1</strong><span>{t('landing.mock_late')}</span></div>
      </div>
      <ul className="landing-phone-people">
        {people.map(person => (
          <li key={person.name}>
            <span className="landing-phone-avatar">{person.name.charAt(0)}</span>
            <span className="landing-phone-person"><b>{person.name}</b><small>{person.detail}</small></span>
            <span className={`landing-chip tone-${person.tone}`}>{person.status}</span>
          </li>
        ))}
      </ul>
      <div className="landing-phone-pay">
        <small>{t('landing.mock_pay')}</small>
        <strong>12.450.000 ₫</strong>
      </div>
    </div>
  );
}

export default function Landing({ onStart, onLogin }) {
  const { t, i18n } = useTranslation();
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi');

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-container landing-nav-inner">
          <BrandLogo size={36} tone="light" tagline={t('brand.tagline')} />
          <div className="landing-nav-actions">
            <button type="button" className="landing-link" onClick={toggleLanguage}>
              <i className="fas fa-globe" aria-hidden="true"></i> {i18n.language === 'vi' ? 'EN' : 'VI'}
            </button>
            <button type="button" className="landing-btn landing-btn-light" onClick={onLogin}>{t('landing.login')}</button>
          </div>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-container landing-hero-grid">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <span className="wea-beans" aria-hidden="true"><span></span><span></span><span></span></span>
              {t('landing.eyebrow')}
            </p>
            <h1>{t('landing.title')}</h1>
            <p className="landing-subtitle">{t('landing.subtitle')}</p>
            <div className="landing-cta">
              <button type="button" className="landing-btn landing-btn-primary" onClick={onStart}>
                {t('landing.start_trial')} <i className="fas fa-arrow-right" aria-hidden="true"></i>
              </button>
              <button type="button" className="landing-btn landing-btn-ghost" onClick={onLogin}>{t('landing.have_account')}</button>
            </div>
            <ul className="landing-assurances">
              <li><i className="fas fa-check-circle" aria-hidden="true"></i> {t('landing.assure_trial')}</li>
              <li><i className="fas fa-check-circle" aria-hidden="true"></i> {t('landing.assure_card')}</li>
              <li><i className="fas fa-check-circle" aria-hidden="true"></i> {t('landing.assure_phone')}</li>
            </ul>
          </div>
          <HeroPreview t={t} />
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-container">
          <h2>{t('landing.features_title')}</h2>
          <div className="landing-features">
            {FEATURES.map(feature => (
              <article key={feature.key} className="landing-card">
                <span className="landing-card-icon"><i className={feature.icon} aria-hidden="true"></i></span>
                <h3>{t(`landing.feature_${feature.key}_title`)}</h3>
                <p>{t(`landing.feature_${feature.key}_body`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-espresso">
        <div className="landing-container landing-audience">
          <BrandMark size={64} />
          <div>
            <h2>{t('landing.audience_title')}</h2>
            <p>{t('landing.audience_body')}</p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-muted">
        <div className="landing-container">
          <h2>{t('landing.steps_title')}</h2>
          <ol className="landing-steps">
            {STEPS.map((step, index) => (
              <li key={step}>
                <span className="landing-step-number">{index + 1}</span>
                <div>
                  <h3>{t(`landing.step_${step}_title`)}</h3>
                  <p>{t(`landing.step_${step}_body`)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="landing-cta landing-cta-center">
            <button type="button" className="landing-btn landing-btn-primary" onClick={onStart}>
              {t('landing.start_trial')} <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <BrandLogo size={30} tone="light" />
          <span>© {new Date().getFullYear()} WeaHR. {t('landing.rights')}</span>
          <a href="mailto:weahr0426@gmail.com">weahr0426@gmail.com</a>
        </div>
      </footer>
    </div>
  );
}
