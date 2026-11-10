import { callBackend } from './backendApi';

const callAttendanceApi = (path, body = {}) => callBackend(`/v1/attendance${path}`, body, {
  notConfiguredMessage: 'Chưa cấu hình VITE_BACKEND_API_URL cho dịch vụ chấm công.',
  fallbackMessage: 'Dịch vụ chấm công không phản hồi.',
  errorCode: 'attendance-api-error',
});

export const requestAttendanceQr = () => callAttendanceApi('/qr');

export const submitSecureAttendance = (action, payload) =>
  callAttendanceApi(action === 'check_in' ? '/check-in' : '/check-out', payload);

export const resolveAttendanceException = (exceptionId, decision, note = '') =>
  callAttendanceApi(`/exceptions/${encodeURIComponent(exceptionId)}/resolve`, { decision, note });
