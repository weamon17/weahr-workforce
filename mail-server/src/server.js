import { assertConfig, config } from './config.js';

assertConfig();

const [{ createApp }, { firebaseAuth, firestore }, { sendBrandedMail, transport }] = await Promise.all([
  import('./app.js'),
  import('./firebaseAdmin.js'),
  import('./mailer.js'),
]);

const app = createApp({
  auth: firebaseAuth,
  firestore,
  sendMail: sendBrandedMail,
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`WeaHR backend listening on 0.0.0.0:${config.port}`);
});

// Email readiness must not block attendance, health checks, or other APIs.
transport.verify()
  .then(() => console.log(`SMTP ready for ${config.gmailUser}`))
  .catch(error => console.warn(`SMTP unavailable at startup: ${error.message}`));
