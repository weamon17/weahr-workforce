import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { assertConfig } from '../src/config.js';
import { firebaseAuth, firestore } from '../src/firebaseAdmin.js';

assertConfig();

const email = String(process.env.TEST_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.TEST_ADMIN_PASSWORD || '');
const organizationId = String(process.env.TEST_ORGANIZATION_ID || 'local-test').trim();
const organizationName = String(process.env.TEST_ORGANIZATION_NAME || 'WeaHR Local Test').trim();
const displayName = 'Quản trị viên Test';

if (!email.includes('@')) throw new Error('TEST_ADMIN_EMAIL không hợp lệ.');
if (password.length < 8) throw new Error('TEST_ADMIN_PASSWORD cần ít nhất 8 ký tự.');
if (!/^[a-zA-Z0-9_-]+$/.test(organizationId)) {
  throw new Error('TEST_ORGANIZATION_ID chỉ được chứa chữ, số, gạch ngang và gạch dưới.');
}

let user;
let created = false;
try {
  user = await firebaseAuth.getUserByEmail(email);
  user = await firebaseAuth.updateUser(user.uid, {
    password,
    displayName,
    emailVerified: true,
    disabled: false,
  });
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error;
  user = await firebaseAuth.createUser({
    email,
    password,
    displayName,
    emailVerified: true,
    disabled: false,
  });
  created = true;
}

await firebaseAuth.setCustomUserClaims(user.uid, {
  role: 'manager',
  organizationId,
  isOrganizationOwner: true,
  testAccount: true,
});

const organizationRef = firestore.collection('organizations').doc(organizationId);
const userRef = firestore.collection('users').doc(user.uid);
const scheduleSettingsRef = firestore.collection('schedule_settings').doc(organizationId);
const [organizationSnapshot, userSnapshot, scheduleSettingsSnapshot] = await Promise.all([
  organizationRef.get(),
  userRef.get(),
  scheduleSettingsRef.get(),
]);

if (organizationSnapshot.exists && organizationSnapshot.data().ownerId !== user.uid) {
  throw new Error(`Workspace ${organizationId} đã thuộc một tài khoản khác; không ghi đè.`);
}

const batch = firestore.batch();
const trialEndsAt = Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);
batch.set(organizationRef, {
  organizationId,
  name: organizationName,
  ownerId: user.uid,
  ownerEmail: email,
  plan: 'development',
  subscriptionStatus: 'active',
  trialEndsAt,
  limits: { branches: 10, employees: 100, managers: 10 },
  ...(organizationSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

batch.set(userRef, {
  uid: user.uid,
  fullName: displayName,
  email,
  role: 'manager',
  isOrganizationOwner: true,
  organizationId,
  status: 'active',
  testAccount: true,
  ...(userSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

if (!scheduleSettingsSnapshot.exists) {
  batch.set(scheduleSettingsRef, {
    organizationId,
    registrationWeekday: 4,
    registrationCloseTime: '18:00',
    reminderEnabled: true,
    autoGenerate: false,
    minShiftsPerEmployee: 0,
    maxShiftsPerEmployee: 6,
    shiftTemplates: [],
    createdAt: FieldValue.serverTimestamp(),
  });
}

await batch.commit();
await firebaseAuth.revokeRefreshTokens(user.uid);

console.log(created ? 'TEST_ADMIN_CREATED' : 'TEST_ADMIN_UPDATED');
console.log(`EMAIL=${email}`);
console.log(`PASSWORD=${password}`);
console.log(`ORGANIZATION_ID=${organizationId}`);
console.log('EMAIL_VERIFIED=true');
