import { config } from './config.js';
import { transport } from './mailer.js';

const looksLikePlaceholder = value => !value || /PASTE_|xxxx|your-|example/i.test(value);

if (looksLikePlaceholder(config.gmailUser) || looksLikePlaceholder(config.gmailAppPassword)) {
  console.error('Chưa điền GMAIL_USER hoặc GMAIL_APP_PASSWORD thật trong mail-server/.env.');
  process.exitCode = 1;
} else {
  try {
    await transport.verify();
    console.log(`SMTP_AUTH_OK: ${config.gmailUser}`);
  } catch (error) {
    console.error('SMTP_AUTH_FAILED:', error.code || 'UNKNOWN', error.responseCode || '');
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}
