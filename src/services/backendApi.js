import { auth } from '../firebase';
import { backendUrl as apiUrl } from './backendUrl';

// Authenticated POST to the WeaHR Node backend (attendance, billing).
export const callBackend = async (path, body = {}, { notConfiguredMessage, fallbackMessage, errorCode }) => {
  if (!apiUrl) {
    const error = new Error(notConfiguredMessage);
    error.code = 'backend-not-configured';
    throw error;
  }
  const user = auth.currentUser;
  if (!user) {
    const error = new Error('Bạn cần đăng nhập lại.');
    error.code = 'unauthenticated';
    throw error;
  }
  const idToken = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    const error = new Error(fallbackMessage);
    error.code = 'backend-unreachable';
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error?.message || fallbackMessage);
    error.code = result.error?.code || errorCode;
    error.details = result.error?.details;
    throw error;
  }
  return result;
};
