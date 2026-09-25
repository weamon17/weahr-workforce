import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('tenant-sensitive manager writes always receive organizationId', async () => {
  const [app, employees, payroll] = await Promise.all([
    read('src/App.jsx'),
    read('src/components/EmployeeTab.jsx'),
    read('src/components/PayrollTab.jsx'),
  ]);
  assert.match(app, /<EmployeeTab[\s\S]*organizationId=\{userProfile\.organizationId\}/);
  assert.doesNotMatch(employees, /VITE_DEFAULT_ORGANIZATION_ID|\|\|\s*'demo'/);
  assert.match(payroll, /where\('organizationId',\s*'==',\s*organizationId\)/);
});

test('security rules block schedule approval and billing mutation from clients', async () => {
  const rules = await read('firestore.rules');
  assert.match(rules, /request\.resource\.data\.status == 'pending'/);
  assert.match(rules, /scheduleType in \['shift_request', 'off_request'\]/);
  assert.match(rules, /hasOnly\(\['name', 'updatedAt'\]\)/);
  assert.match(rules, /hasOnly\(\['selectedSlotIds', 'submittedAt', 'status', 'position', 'hourlyRate', 'skills'\]\)/);
  const availability = rules.slice(rules.indexOf('match /availability_submissions/'), rules.indexOf('match /weekly_assignments/'));
  assert.equal((availability.match(/matchesOwnProfile\(request\.resource\.data\)/g) || []).length, 2);
  assert.match(rules, /data\.skills == profile\.skills/);
});

test('employee account status changes use a trusted backend function', async () => {
  const [component, backend] = await Promise.all([
    read('src/components/EmployeeTab.jsx'),
    read('functions/index.js'),
  ]);
  assert.match(component, /httpsCallable\(functions, 'setEmployeeAccountStatus'\)/);
  assert.match(backend, /exports\.setEmployeeAccountStatus = onCall/);
  assert.match(backend, /getAuth\(\)/);
  assert.match(backend, /updateUser\(employeeId, \{ disabled:/);
});

test('linked employee renames are synchronized by a trusted backend function', async () => {
  const [component, backend] = await Promise.all([
    read('src/components/EmployeeTab.jsx'),
    read('functions/index.js'),
  ]);
  assert.match(component, /httpsCallable\(functions, 'renameEmployeeAccount'\)/);
  assert.match(backend, /exports\.renameEmployeeAccount = onCall/);
  assert.match(backend, /'timesheets',[\s\S]*'payrolls',[\s\S]*'weekly_assignments'/);
  assert.match(backend, /where\('fromEmployeeId', '==', employeeId\)/);
});

test('inactive employees are denied tenant resources by security rules', async () => {
  const rules = await read('firestore.rules');
  assert.match(rules, /function isActiveUser\(\)/);
  assert.match(rules, /function ownsResource\(\)[\s\S]*isActiveUser\(\)/);
  assert.match(rules, /function sameNewOrganization\(\)[\s\S]*isActiveUser\(\)/);
});

test('authentication fields expose accessible labels and stable names', async () => {
  const auth = await read('src/components/Auth.jsx');
  assert.match(auth, /<label htmlFor=\{inputId\}>/);
  assert.match(auth, /id=\{inputId\}/);
  assert.match(auth, /name=\{name\}/);
});

test('local demo login is development-only and cloud writes are blocked', async () => {
  const [auth, app, timesheet, employee, payroll] = await Promise.all([
    read('src/components/Auth.jsx'),
    read('src/App.jsx'),
    read('src/components/TimesheetTab.jsx'),
    read('src/components/EmployeeTab.jsx'),
    read('src/components/PayrollTab.jsx'),
  ]);
  assert.match(auth, /import\.meta\.env\.DEV/);
  assert.match(app, /demoMode=\{demoMode\}/);
  assert.match(timesheet, /if \(demoMode\) return showToast/);
  assert.match(employee, /if \(demoMode\) return showToast/);
  assert.match(payroll, /if \(!demoMode\) return false/);
});

test('branded authentication email uses a standalone trusted backend', async () => {
  const [auth, client, backend, config, rules] = await Promise.all([
    read('src/components/Auth.jsx'),
    read('src/services/authEmail.js'),
    read('mail-server/src/app.js'),
    read('mail-server/src/config.js'),
    read('firestore.rules'),
  ]);
  assert.doesNotMatch(auth, /sendEmailVerification|sendPasswordResetEmail/);
  assert.match(auth, /sendVerificationEmail/);
  assert.match(auth, /requestPasswordResetEmail/);
  assert.match(client, /Authorization: `Bearer \$\{idToken\}`/);
  assert.match(backend, /verifyIdToken\(token, true\)/);
  assert.match(backend, /normalizeEmail\(user\.email\) !== email/);
  assert.match(backend, /generateEmailVerificationLink/);
  assert.match(backend, /generatePasswordResetLink/);
  assert.match(backend, /Do not reveal delivery or account existence details/);
  assert.match(config, /GMAIL_APP_PASSWORD/);
  assert.match(config, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(rules, /match \/email_dispatch_limits\/\{documentId\}[\s\S]*allow read, write: if false/);
});

test('shift swap claims stay in-tenant and cannot self-approve', async () => {
  const rules = await read('firestore.rules');
  const swap = rules.slice(rules.indexOf('match /shift_swap_requests/'), rules.indexOf('match /sales_records/'));
  assert.match(swap, /request\.resource\.data\.status == 'claimed'/);
  assert.match(swap, /resource\.data\.fromEmployeeId != request\.auth\.uid/);
  assert.doesNotMatch(swap, /\|\| \(isActiveUser\(\)\s*&& resource\.data\.status == 'open'/);
  const panel = await read('src/components/manager/WeeklySchedulerPanel.jsx');
  assert.match(panel, /if \(!offeredShift\) throw new Error\(t\('scheduler\.swap_shift_gone'\)\)/);
});

test('audit logs are append-only', async () => {
  const rules = await read('firestore.rules');
  const audit = rules.slice(rules.indexOf('match /audit_logs/'), rules.indexOf('match /schedule_settings/'));
  assert.match(audit, /allow update, delete: if false;/);
});
