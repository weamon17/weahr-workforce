import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { createKiosk, revokeKiosk } from '../../services/attendanceApi';
import { buildKioskLink } from '../../utils/kiosk';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

// Lets a manager pair counter tablets that show the attendance QR without
// being signed in, and revoke them if a tablet is lost or replaced.
export default function KioskDevicesCard({ db, organizationId, showToast, showConfirm }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const [kiosks, setKiosks] = useState([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState(null);
  const [pairingQr, setPairingQr] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => onSnapshot(
    query(collection(db, 'attendance_kiosks'), where('organizationId', '==', organizationId)),
    snapshot => setKiosks(snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (left.status === right.status ? 0 : left.status === 'active' ? -1 : 1))),
    error => console.error(error),
  ), [db, organizationId]);

  useEffect(() => {
    if (!pairing) return undefined;
    let cancelled = false;
    import('qrcode').then(async module => {
      const QRCode = module.default || module;
      const image = await QRCode.toDataURL(pairing.link, { width: 260, margin: 1, color: { dark: '#2b1a12', light: '#ffffff' } });
      if (!cancelled) setPairingQr(image);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pairing]);

  const pair = async event => {
    event.preventDefault();
    setCreating(true);
    try {
      const result = await createKiosk(name.trim() || t('kiosk.default_name'));
      setPairingQr('');
      setPairing({
        name: result.name,
        link: buildKioskLink(window.location.origin, window.location.pathname, result.credential),
      });
      setName('');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pairing.link);
      showToast(t('billing.copied'));
    } catch {
      showToast(t('org.copy_failed'), 'warning');
    }
  };

  const revoke = kiosk => {
    const run = async () => {
      setBusyId(kiosk.id);
      try {
        await revokeKiosk(kiosk.id);
        showToast(t('kiosk.revoked_toast', { name: kiosk.name }));
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        setBusyId('');
      }
    };
    if (showConfirm) showConfirm(t('kiosk.revoke_confirm', { name: kiosk.name }), run);
    else run();
  };

  const lastSeenText = kiosk => {
    const seen = kiosk.lastSeenAt?.toDate?.();
    if (kiosk.status !== 'active') return t('kiosk.status_revoked');
    if (!seen) return t('kiosk.status_waiting');
    if (Date.now() - seen.getTime() < ONLINE_WINDOW_MS) return t('kiosk.status_online');
    return t('kiosk.status_last_seen', { time: seen.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) });
  };

  return (
    <section className="kiosk-devices" aria-labelledby="kiosk-devices-title">
      <div className="kiosk-devices-head">
        <div>
          <h3 id="kiosk-devices-title"><i className="fas fa-tablet-screen-button" aria-hidden="true"></i> {t('kiosk.manage_title')}</h3>
          <p>{t('kiosk.manage_sub')}</p>
        </div>
        <form className="kiosk-pair-form" onSubmit={pair}>
          <input value={name} maxLength={60} onChange={event => setName(event.target.value)} placeholder={t('kiosk.name_placeholder')} aria-label={t('kiosk.name_label')} />
          <button type="submit" className="btn-primary" disabled={creating}>
            <i className="fas fa-plus" aria-hidden="true"></i> {creating ? t('kiosk.pairing') : t('kiosk.pair')}
          </button>
        </form>
      </div>

      {pairing && (
        <div className="kiosk-pairing" role="status">
          <div className="kiosk-pairing-qr">
            {pairingQr ? <img src={pairingQr} alt={t('kiosk.pairing_qr_alt')} width="180" height="180" /> : <div className="spinner" />}
          </div>
          <div className="kiosk-pairing-text">
            <strong>{t('kiosk.pairing_title', { name: pairing.name })}</strong>
            <ol>
              <li>{t('kiosk.pairing_step_1')}</li>
              <li>{t('kiosk.pairing_step_2')}</li>
              <li>{t('kiosk.pairing_step_3')}</li>
            </ol>
            <div className="kiosk-pairing-link">
              <input readOnly value={pairing.link} onFocus={event => event.target.select()} aria-label={t('kiosk.pairing_link')} />
              <button type="button" className="btn-secondary" onClick={copyLink}><i className="fas fa-copy" aria-hidden="true"></i> {t('org.copy_link')}</button>
            </div>
            <p className="kiosk-pairing-warning"><i className="fas fa-lock" aria-hidden="true"></i> {t('kiosk.pairing_warning')}</p>
            <button type="button" className="auth-link" onClick={() => setPairing(null)}>{t('kiosk.pairing_done')}</button>
          </div>
        </div>
      )}

      {kiosks.length === 0 ? (
        <p className="kiosk-devices-empty">{t('kiosk.none')}</p>
      ) : (
        <ul className="kiosk-list">
          {kiosks.map(kiosk => {
            const online = kiosk.status === 'active' && Date.now() - (kiosk.lastSeenAt?.toDate?.()?.getTime() || 0) < ONLINE_WINDOW_MS;
            return (
              <li key={kiosk.id} className={kiosk.status !== 'active' ? 'is-revoked' : ''}>
                <span className={`kiosk-dot ${online ? 'is-online' : ''}`} aria-hidden="true"></span>
                <span className="kiosk-list-main">
                  <strong>{kiosk.name}</strong>
                  <small>{lastSeenText(kiosk)}</small>
                </span>
                {kiosk.status === 'active' && (
                  <button type="button" className="btn-danger" disabled={busyId === kiosk.id} onClick={() => revoke(kiosk)}>{t('kiosk.revoke')}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
