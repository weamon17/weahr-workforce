import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { submitSecureAttendance } from '../../services/attendanceApi';

let sessionDeviceId = '';

// Stable per-browser identifier. Storage can be blocked (e.g. private mode),
// in which case the id only lasts for this session and the manager may be
// asked to approve the device.
const getDeviceId = () => {
  const key = 'weahr_attendance_device_id';
  const create = () => globalThis.crypto?.randomUUID?.() || `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = create();
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    sessionDeviceId = sessionDeviceId || create();
    return sessionDeviceId;
  }
};

const GPS_ERROR_KEYS = { 1: 'checkin.gps_denied', 2: 'checkin.gps_unavailable', 3: 'checkin.gps_timeout' };

const getPosition = t => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error(t('checkin.no_gps')));
  navigator.geolocation.getCurrentPosition(position => resolve({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  }), error => reject(new Error(t(GPS_ERROR_KEYS[error.code] || 'checkin.gps_unavailable'))), {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0,
  });
});

export default function SecureAttendanceButton({ action, scheduleId, disabled, label, completedLabel, onSuccess, showToast }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);

  const closeScanner = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setOpen(false);
    setCameraError('');
  };

  const execute = async qrPayload => {
    if (!qrPayload.trim() || busy) return;
    setBusy(true);
    try {
      const position = await getPosition(t);
      const response = await submitSecureAttendance(action, {
        qrPayload: qrPayload.trim(),
        deviceId: getDeviceId(),
        scheduleId: scheduleId || '',
        ...position,
      });
      closeScanner();
      onSuccess(response);
      showToast(t('checkin.success', { action: action === 'check_in' ? 'Check-in' : 'Check-out', time: response.checkIn || response.checkOut }), 'success');
    } catch (error) {
      const hasException = error.details?.exceptionId;
      showToast(`${error.message}${hasException ? t('checkin.exception_sent') : ''}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const start = async () => {
      if (!('BarcodeDetector' in window)) {
        setCameraError(t('checkin.no_scanner'));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!active) return stream.getTracks().forEach(track => track.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const scan = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              active = false;
              await execute(codes[0].rawValue);
              return;
            }
          } catch {
            // Decoding can fail briefly while the camera focuses.
          }
          frameRef.current = requestAnimationFrame(scan);
        };
        scan();
      } catch (error) {
        setCameraError(t('checkin.camera_failed', { error: error.message }));
      }
    };
    start();
    return () => {
      active = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
    // The scanner session deliberately keeps the action selected when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isCheckIn = action === 'check_in';
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={disabled || busy} style={{
        padding: '20px', borderRadius: '16px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? '#e2e8f0' : isCheckIn ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #4f46e5, #3730a3)',
        color: disabled ? '#94a3b8' : 'white', fontSize: '1.05rem', fontWeight: 700,
        boxShadow: disabled ? 'none' : `0 4px 15px ${isCheckIn ? 'rgba(16,185,129,.3)' : 'rgba(79,70,229,.3)'}`,
      }}>
        <i className="fas fa-qrcode" style={{ marginRight: '10px' }} />{disabled && completedLabel ? completedLabel : label}
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.8)', display: 'grid', placeItems: 'center', padding: '20px' }}>
          <div style={{ width: 'min(460px, 100%)', background: 'white', borderRadius: '18px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{t('checkin.scanner_title')}</h3>
              <button className="btn-secondary" onClick={closeScanner}>{t('checkin.close')}</button>
            </div>
            <video ref={videoRef} muted playsInline style={{ width: '100%', minHeight: '220px', background: '#0f172a', borderRadius: '12px', marginTop: '14px', objectFit: 'cover' }} />
            <p style={{ color: cameraError ? '#b45309' : '#64748b', fontSize: '.88rem' }}>{cameraError || t('checkin.scanner_help')}</p>
            <details>
              <summary style={{ cursor: 'pointer', color: '#475569' }}>{t('checkin.manual_toggle')}</summary>
              <textarea value={manualValue} onChange={event => setManualValue(event.target.value)} rows="3" placeholder={t('checkin.manual_placeholder')} style={{ width: '100%', marginTop: '9px', padding: '9px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <button className="btn-primary" disabled={busy || !manualValue.trim()} onClick={() => execute(manualValue)} style={{ width: '100%', marginTop: '8px' }}>{busy ? t('checkin.verifying') : t('checkin.verify')}</button>
            </details>
          </div>
        </div>
      )}
    </>
  );
}
