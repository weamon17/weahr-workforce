import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../brand/BrandLogo';
import { fetchKioskQr } from '../../services/kioskApi';
import { clearKioskCredential } from '../../utils/kiosk';
import '../../App.css';
import './Kiosk.css';

const RETRY_MS = 10000;
const REFRESH_EARLY_MS = 6000;
const UNPAIRED_CODES = new Set(['kiosk-revoked', 'kiosk-unauthenticated']);

// Full-screen attendance QR for a tablet at the counter. It holds no account:
// only a kiosk credential that can fetch this shop's rotating QR code.
export default function KioskScreen({ credential }) {
  const { t, i18n } = useTranslation();
  const [qrImage, setQrImage] = useState('');
  const [info, setInfo] = useState({ shopName: '', kioskName: '', expiresAt: 0, ttlSeconds: 45 });
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef(null);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const result = await fetchKioskQr(credential);
      const module = await import('qrcode');
      const QRCode = module.default || module;
      setQrImage(await QRCode.toDataURL(result.qrPayload, {
        width: 640,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#2b1a12', light: '#ffffff' },
      }));
      setInfo({ shopName: result.shopName, kioskName: result.kioskName, expiresAt: result.expiresAt, ttlSeconds: result.ttlSeconds });
      setError(null);
      const wait = Math.max(5000, result.expiresAt - Date.now() - REFRESH_EARLY_MS);
      timer.current = setTimeout(load, wait);
    } catch (failure) {
      setError({ code: failure.code, message: failure.message });
      if (!UNPAIRED_CODES.has(failure.code)) timer.current = setTimeout(load, RETRY_MS);
    }
  }, [credential]);

  useEffect(() => {
    load();
    const reload = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', reload);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Keep the counter screen awake where the browser allows it.
  useEffect(() => {
    let lock = null;
    const request = async () => {
      try {
        if (document.visibilityState === 'visible' && navigator.wakeLock) lock = await navigator.wakeLock.request('screen');
      } catch {
        lock = null;
      }
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      document.removeEventListener('visibilitychange', request);
      lock?.release?.().catch(() => {});
    };
  }, []);

  const exitKiosk = () => {
    if (!window.confirm(t('kiosk.exit_confirm'))) return;
    clearKioskCredential();
    window.location.replace(window.location.pathname);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const clock = new Date(now);
  const secondsLeft = Math.max(0, Math.ceil((info.expiresAt - now) / 1000));
  const progress = info.ttlSeconds ? Math.min(100, (secondsLeft / info.ttlSeconds) * 100) : 0;
  const unpaired = error && UNPAIRED_CODES.has(error.code);

  return (
    <div className="kiosk">
      <header className="kiosk-top">
        <BrandLogo size={44} tone="light" tagline={t('brand.tagline')} />
        <div className="kiosk-top-actions">
          <button type="button" className="kiosk-ghost" onClick={() => i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi')}>
            <i className="fas fa-globe" aria-hidden="true"></i> {i18n.language === 'vi' ? 'EN' : 'VI'}
          </button>
          <button type="button" className="kiosk-ghost" onClick={toggleFullscreen} aria-label={t('kiosk.fullscreen')}>
            <i className="fas fa-expand" aria-hidden="true"></i>
          </button>
        </div>
      </header>

      <main className="kiosk-body">
        <section className="kiosk-side">
          <p className="kiosk-shop">{info.shopName || t('brand.shop_fallback')}</p>
          <p className="kiosk-clock">{clock.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</p>
          <p className="kiosk-date">{clock.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <ol className="kiosk-steps">
            <li><span>1</span>{t('kiosk.step_open')}</li>
            <li><span>2</span>{t('kiosk.step_scan')}</li>
            <li><span>3</span>{t('kiosk.step_location')}</li>
          </ol>
        </section>

        <section className="kiosk-card" aria-live="polite">
          {unpaired ? (
            <div className="kiosk-message">
              <i className="fas fa-link-slash" aria-hidden="true"></i>
              <h2>{t(error.code === 'kiosk-revoked' ? 'kiosk.revoked_title' : 'kiosk.unpaired_title')}</h2>
              <p>{t('kiosk.unpaired_body')}</p>
              <button type="button" className="btn-primary" onClick={exitKiosk}>{t('kiosk.exit')}</button>
            </div>
          ) : (
            <>
              <h2 className="kiosk-card-title">{t('kiosk.scan_title')}</h2>
              <div className={`kiosk-qr ${error ? 'is-stale' : ''}`}>
                {qrImage ? <img src={qrImage} alt={t('attendance.qr_alt')} /> : <div className="spinner" />}
              </div>
              {error ? (
                <p className="kiosk-error"><i className="fas fa-wifi" aria-hidden="true"></i> {t('kiosk.offline', { error: error.message })}</p>
              ) : (
                <>
                  <div className="kiosk-progress" aria-hidden="true"><span style={{ width: `${progress}%` }}></span></div>
                  <p className="kiosk-countdown">{t('kiosk.rotates_in', { seconds: secondsLeft })}</p>
                </>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="kiosk-foot">
        <span>{info.kioskName ? `${info.kioskName} · ` : ''}© {clock.getFullYear()} WeaHR</span>
        {!unpaired && <button type="button" className="kiosk-exit" onClick={exitKiosk}>{t('kiosk.exit')}</button>}
      </footer>
    </div>
  );
}
