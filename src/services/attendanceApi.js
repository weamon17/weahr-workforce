import { auth } from '../firebase';

const configuredApiUrl = String(
  import.meta.env.VITE_BACKEND_API_URL
  || import.meta.env.VITE_MAIL_API_URL
  || '',
).trim();

const apiUrl = (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:8787' : ''))
  .replace(/\/+$/, '');

const callAttendanceApi = async (path, body = {}) => {
  if (!apiUrl) {
    const error = new Error('Chưa cấu hình VITE_BACKEND_API_URL cho dịch vụ chấm công.');
    error.code = 'attendance-api-not-configured';
    throw error;
  }
  const user = auth.currentUser;
  if (!user) {
    const error = new Error('Bạn cần đăng nhập lại để sử dụng chấm công.');
    error.code = 'unauthenticated';
    throw error;
  }
  const idToken = await user.getIdToken();
  const response = await fetch(`${apiUrl}/v1/attendance${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error?.message || 'Dịch vụ chấm công không phản hồi.');
    error.code = result.error?.code || 'attendance-api-error';
    error.details = result.error?.details;
    throw error;
  }
  return result;
};

export const requestAttendanceQr = () => callAttendanceApi('/qr');

export const submitSecureAttendance = (action, payload) =>
  callAttendanceApi(action === 'check_in' ? '/check-in' : '/check-out', payload);

export const resolveAttendanceException = (exceptionId, decision, note = '') =>
  callAttendanceApi(`/exceptions/${encodeURIComponent(exceptionId)}/resolve`, { decision, note });

