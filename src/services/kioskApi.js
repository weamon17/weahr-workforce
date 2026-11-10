import { backendUrl } from './backendUrl';

// Asks the backend for this counter kiosk's current attendance QR.
// The kiosk credential replaces a signed-in account on shared devices.
export const fetchKioskQr = async credential => {
  if (!backendUrl) {
    const error = new Error('Chưa cấu hình máy chủ WeaHR.');
    error.code = 'backend-not-configured';
    throw error;
  }
  let response;
  try {
    response = await fetch(`${backendUrl}/v1/attendance/kiosk/qr`, {
      method: 'POST',
      headers: { Authorization: `Kiosk ${credential}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    const error = new Error('Mất kết nối tới máy chủ WeaHR.');
    error.code = 'backend-unreachable';
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error?.message || 'Máy chủ chấm công không phản hồi.');
    error.code = result.error?.code || 'kiosk-error';
    throw error;
  }
  return result;
};
