import { callBackend } from './backendApi';

// Manual attendance changes go through the backend, which writes the record
// and its audit-log entry together.
const callTimesheetApi = (path, body) => callBackend(`/v1/timesheets${path}`, body, {
  notConfiguredMessage: 'Chưa cấu hình VITE_BACKEND_API_URL cho dịch vụ chấm công.',
  fallbackMessage: 'Không lưu được chấm công. Vui lòng thử lại.',
  errorCode: 'timesheet-api-error',
});

export const createTimesheet = (record, reason = '') => callTimesheetApi('', { record, reason });

export const updateTimesheet = (recordId, record, reason) =>
  callTimesheetApi(`/${encodeURIComponent(recordId)}/update`, { record, reason });

export const deleteTimesheet = (recordId, reason) =>
  callTimesheetApi(`/${encodeURIComponent(recordId)}/delete`, { reason });

export const renameTimesheetEmployee = (fromName, toName) =>
  callTimesheetApi('/rename', { fromName, toName });
