import { callBackend } from './backendApi';

// The backend prices the order; the client only says which plan and cycle.
export const createBillingOrder = (plan, cycle) => callBackend('/v1/billing/orders', { plan, cycle }, {
  notConfiguredMessage: 'Chưa cấu hình VITE_BACKEND_API_URL cho dịch vụ thanh toán.',
  fallbackMessage: 'Dịch vụ thanh toán không phản hồi. Vui lòng thử lại.',
  errorCode: 'billing-api-error',
});
