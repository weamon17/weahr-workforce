// Base URL of the WeaHR Node backend. Kept free of Firebase imports so the
// counter kiosk screen can reach the backend without loading Firebase.
const configuredApiUrl = String(
  import.meta.env.VITE_BACKEND_API_URL
  || import.meta.env.VITE_MAIL_API_URL
  || '',
).trim();

export const backendUrl = (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:8787' : ''))
  .replace(/\/+$/, '');
