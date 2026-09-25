const configuredMailApiUrl = String(import.meta.env.VITE_MAIL_API_URL || '').trim();
const mailApiUrl = (configuredMailApiUrl || (import.meta.env.DEV ? 'http://localhost:8787' : ''))
  .replace(/\/+$/, '');

const parseResponse = async response => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error?.message || 'Dịch vụ email không phản hồi.');
    error.code = body.error?.code || 'mail-api-error';
    throw error;
  }
  return body;
};

const requireMailApi = () => {
  if (!mailApiUrl) {
    const error = new Error('Chưa cấu hình VITE_MAIL_API_URL cho dịch vụ gửi mail.');
    error.code = 'mail-api-not-configured';
    throw error;
  }
};

export const sendVerificationEmail = async user => {
  requireMailApi();
  const idToken = await user.getIdToken();
  const response = await fetch(`${mailApiUrl}/v1/auth/verification-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return parseResponse(response);
};

export const requestPasswordResetEmail = async email => {
  requireMailApi();
  const response = await fetch(`${mailApiUrl}/v1/auth/password-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase() }),
  });
  return parseResponse(response);
};
