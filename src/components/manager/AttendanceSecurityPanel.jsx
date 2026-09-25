import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { requestAttendanceQr, resolveAttendanceException } from '../../services/attendanceApi';

const defaults = {
  latitude: '',
  longitude: '',
  radiusMeters: 100,
  qrTtlSeconds: 45,
  maxDevicesPerEmployee: 1,
  earlyCheckInMinutes: 30,
  lateCheckInMinutes: 120,
  maxGpsAccuracyMeters: 80,
};

export default function AttendanceSecurityPanel({ organizationId, db, showToast }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(defaults);
  const [saving, setSaving] = useState(false);
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const [qrExpiresAt, setQrExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [exceptions, setExceptions] = useState([]);
  const [resolvingId, setResolvingId] = useState('');

  const loadExceptions = useCallback(async () => {
    const snapshot = await getDocs(query(
      collection(db, 'attendance_exceptions'),
      where('organizationId', '==', organizationId),
      where('status', '==', 'pending'),
    ));
    setExceptions(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  }, [db, organizationId]);

  useEffect(() => {
    getDoc(doc(db, 'attendance_settings', organizationId)).then(snapshot => {
      if (snapshot.exists()) setSettings({ ...defaults, ...snapshot.data() });
    }).catch(() => undefined);
    loadExceptions().catch(() => undefined);
  }, [db, organizationId, loadExceptions]);

  const refreshQr = useCallback(async () => {
    try {
      setQrError('');
      const response = await requestAttendanceQr();
      const module = await import('qrcode');
      const QRCode = module.default || module;
      setQrImage(await QRCode.toDataURL(response.qrPayload, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: 'M',
      }));
      setQrExpiresAt(response.expiresAt);
    } catch (error) {
      setQrImage('');
      setQrExpiresAt(0);
      setQrError(error.message);
      showToast(t('attendance.qr_failed', { error: error.message }), 'error');
    }
  }, [showToast, t]);

  useEffect(() => {
    if (!settings.latitude || !settings.longitude) return undefined;
    refreshQr();
    const interval = setInterval(refreshQr, Math.max(25, Number(settings.qrTtlSeconds) - 5) * 1000);
    return () => clearInterval(interval);
  }, [refreshQr, settings.latitude, settings.longitude, settings.qrTtlSeconds]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const saveSettings = async () => {
    const latitude = Number(settings.latitude);
    const longitude = Number(settings.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      showToast(t('attendance.invalid_coordinates'), 'warning');
      return;
    }
    setSaving(true);
    try {
      const normalized = {
        organizationId,
        latitude,
        longitude,
        radiusMeters: Math.min(500, Math.max(30, Number(settings.radiusMeters) || 100)),
        qrTtlSeconds: Math.min(60, Math.max(30, Number(settings.qrTtlSeconds) || 45)),
        maxDevicesPerEmployee: Math.min(3, Math.max(1, Number(settings.maxDevicesPerEmployee) || 1)),
        earlyCheckInMinutes: Math.min(180, Math.max(0, Number(settings.earlyCheckInMinutes) || 30)),
        lateCheckInMinutes: Math.min(360, Math.max(0, Number(settings.lateCheckInMinutes) || 120)),
        maxGpsAccuracyMeters: Math.min(200, Math.max(20, Number(settings.maxGpsAccuracyMeters) || 80)),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'attendance_settings', organizationId), normalized, { merge: true });
      setSettings(prev => ({ ...prev, ...normalized }));
      showToast(t('attendance.settings_saved'), 'success');
      await refreshQr();
    } catch (error) {
      showToast(t('attendance.settings_failed', { error: error.message }), 'error');
    } finally {
      setSaving(false);
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return showToast(t('attendance.no_geolocation'), 'warning');
    navigator.geolocation.getCurrentPosition(position => {
      setSettings(prev => ({
        ...prev,
        latitude: position.coords.latitude.toFixed(7),
        longitude: position.coords.longitude.toFixed(7),
      }));
      showToast(t('attendance.location_captured'), 'success');
    }, error => showToast(t('attendance.location_failed', { error: error.message }), 'error'), {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  };

  const resolveException = async (exceptionId, decision) => {
    setResolvingId(exceptionId);
    try {
      await resolveAttendanceException(exceptionId, decision);
      setExceptions(items => items.filter(item => item.id !== exceptionId));
      showToast(decision === 'approved' ? t('attendance.exception_approved') : t('attendance.exception_rejected'), 'success');
    } catch (error) {
      showToast(t('attendance.exception_failed', { error: error.message }), 'error');
    } finally {
      setResolvingId('');
    }
  };

  const secondsLeft = Math.max(0, Math.ceil((qrExpiresAt - now) / 1000));
  const inputStyle = { width: '100%', padding: '9px 10px', border: '1px solid #dbe3ee', borderRadius: '8px' };

  return (
    <section className="card" style={{ marginBottom: '22px', padding: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('attendance.title')}</h2>
          <p style={{ color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('attendance.subtitle')}</p>
        </div>
        <span style={{ background: '#dcfce7', color: '#15803d', padding: '7px 11px', borderRadius: '999px', fontWeight: 700 }}>Server verified</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: '22px', marginTop: '20px' }}>
        <div>
          <h3 style={{ marginTop: 0 }}>{t('attendance.policy_title')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label>{t('attendance.field_latitude')}<input style={inputStyle} value={settings.latitude} onChange={event => setSettings(prev => ({ ...prev, latitude: event.target.value }))} /></label>
            <label>{t('attendance.field_longitude')}<input style={inputStyle} value={settings.longitude} onChange={event => setSettings(prev => ({ ...prev, longitude: event.target.value }))} /></label>
            <label>{t('attendance.field_radius')}<input style={inputStyle} type="number" min="30" max="500" value={settings.radiusMeters} onChange={event => setSettings(prev => ({ ...prev, radiusMeters: event.target.value }))} /></label>
            <label>{t('attendance.field_qr_ttl')}<input style={inputStyle} type="number" min="30" max="60" value={settings.qrTtlSeconds} onChange={event => setSettings(prev => ({ ...prev, qrTtlSeconds: event.target.value }))} /></label>
            <label>{t('attendance.field_devices')}<input style={inputStyle} type="number" min="1" max="3" value={settings.maxDevicesPerEmployee} onChange={event => setSettings(prev => ({ ...prev, maxDevicesPerEmployee: event.target.value }))} /></label>
            <label>{t('attendance.field_early')}<input style={inputStyle} type="number" min="0" max="180" value={settings.earlyCheckInMinutes} onChange={event => setSettings(prev => ({ ...prev, earlyCheckInMinutes: event.target.value }))} /></label>
            <label>{t('attendance.field_late')}<input style={inputStyle} type="number" min="0" max="360" value={settings.lateCheckInMinutes} onChange={event => setSettings(prev => ({ ...prev, lateCheckInMinutes: event.target.value }))} /></label>
            <label>{t('attendance.field_accuracy')}<input style={inputStyle} type="number" min="20" max="200" value={settings.maxGpsAccuracyMeters} onChange={event => setSettings(prev => ({ ...prev, maxGpsAccuracyMeters: event.target.value }))} /></label>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={useCurrentLocation}>{t('attendance.use_current_location')}</button>
            <button className="btn-primary" disabled={saving} onClick={saveSettings}>{saving ? t('attendance.saving') : t('attendance.save')}</button>
          </div>
        </div>

        <div style={{ textAlign: 'center', background: '#f8fafc', borderRadius: '14px', padding: '16px' }}>
          <h3 style={{ margin: '0 0 8px' }}>{t('attendance.qr_title')}</h3>
          {qrImage
            ? <img src={qrImage} alt={t('attendance.qr_alt')} style={{ width: 'min(100%, 260px)', borderRadius: '10px' }} />
            : (
              <div style={{ padding: '55px 20px', color: qrError ? '#b91c1c' : '#64748b' }}>
                {qrError || t('attendance.qr_needs_location')}
              </div>
            )}
          <p style={{ margin: '6px 0', fontWeight: 700, color: secondsLeft <= 10 ? '#dc2626' : '#334155' }}>{t('attendance.qr_rotates_in', { seconds: secondsLeft })}</p>
          <button className="btn-secondary" onClick={refreshQr}>{t('attendance.qr_refresh')}</button>
        </div>
      </div>

      <div style={{ marginTop: '22px' }}>
        <h3>{t('attendance.exceptions_title', { count: exceptions.length })}</h3>
        {exceptions.length === 0 ? <p style={{ color: '#64748b' }}>{t('attendance.no_exceptions')}</p> : exceptions.map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', borderTop: '1px solid #e2e8f0', padding: '12px 0', flexWrap: 'wrap' }}>
            <div>
              <b>{item.employeeName}</b> · {item.action === 'check_in' ? 'Check-in' : 'Check-out'} {t('attendance.attempt_at', { time: item.attemptedTime })}
              <div style={{ color: '#b45309', fontSize: '.88rem' }}>{t(`attendance.reason_${item.reason}`, { defaultValue: item.reason })}{item.distance != null ? t('attendance.distance_away', { meters: item.distance }) : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-secondary" disabled={resolvingId === item.id} onClick={() => resolveException(item.id, 'rejected')}>{t('attendance.reject')}</button>
              <button className="btn-primary" disabled={resolvingId === item.id} onClick={() => resolveException(item.id, 'approved')}>{t('attendance.approve')}</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
