import React from 'react';
import { useTranslation } from 'react-i18next';
import './Landing.css';

const FEATURES = [
  { icon: 'fas fa-qrcode', key: 'attendance' },
  { icon: 'fas fa-calendar-alt', key: 'schedule' },
  { icon: 'fas fa-file-invoice-dollar', key: 'payroll' },
  { icon: 'fas fa-chart-line', key: 'insights' },
];

const STEPS = ['workspace', 'invite', 'checkin'];

export default function Landing({ onStart, onLogin }) {
  const { t, i18n } = useTranslation();
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi');

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-container landing-nav-inner">
          <span className="landing-brand">
            <img src="/wea-hr-icon.svg" alt="" width="32" height="32" /> WeaHR
          </span>
          <div className="landing-nav-actions">
            <button type="button" className="landing-link" onClick={toggleLanguage}>
              <i className="fas fa-globe" aria-hidden="true"></i> {i18n.language === 'vi' ? 'EN' : 'VI'}
            </button>
            <button type="button" className="landing-btn landing-btn-ghost" onClick={onLogin}>{t('landing.login')}</button>
          </div>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-container">
          <p className="landing-eyebrow">{t('landing.eyebrow')}</p>
          <h1>{t('landing.title')}</h1>
          <p className="landing-subtitle">{t('landing.subtitle')}</p>
          <div className="landing-cta">
            <button type="button" className="landing-btn landing-btn-primary" onClick={onStart}>{t('landing.start_trial')}</button>
            <button type="button" className="landing-btn landing-btn-ghost" onClick={onLogin}>{t('landing.have_account')}</button>
          </div>
          <ul className="landing-assurances">
            <li><i className="fas fa-check-circle" aria-hidden="true"></i> {t('landing.assure_trial')}</li>
            <li><i className="fas fa-check-circle" aria-hidden="true"></i> {t('landing.assure_card')}</li>
            <li><i className="fas fa-check-circle" aria-hidden="true"></i> {t('landing.assure_phone')}</li>
          </ul>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-container">
          <h2>{t('landing.features_title')}</h2>
          <div className="landing-features">
            {FEATURES.map(feature => (
              <article key={feature.key} className="landing-card">
                <i className={feature.icon} aria-hidden="true"></i>
                <h3>{t(`landing.feature_${feature.key}_title`)}</h3>
                <p>{t(`landing.feature_${feature.key}_body`)}</p>
              </article>
            ))}
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
            <button type="button" className="landing-btn landing-btn-primary" onClick={onStart}>{t('landing.start_trial')}</button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container">
          <span>&copy; {new Date().getFullYear()} WeaHR</span>
          <a href="mailto:weahr0426@gmail.com">weahr0426@gmail.com</a>
        </div>
      </footer>
    </div>
  );
}
