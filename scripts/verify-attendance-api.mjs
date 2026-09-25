import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { deleteDoc, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig, 'attendance-api-verifier');
const auth = getAuth(app);
const db = getFirestore(app);
const organizationId = String(process.env.TEST_ORGANIZATION_ID || 'local-test');
const apiUrl = String(process.env.VITE_BACKEND_API_URL || process.env.VITE_MAIL_API_URL || 'http://localhost:8787')
  .replace(/\/+$/, '');

const credential = await signInWithEmailAndPassword(
  auth,
  String(process.env.TEST_ADMIN_EMAIL || '').trim().toLowerCase(),
  String(process.env.TEST_ADMIN_PASSWORD || ''),
);

let createdSettings = false;
try {
  const settingsRef = doc(db, 'attendance_settings', organizationId);
  const settingsSnapshot = await getDoc(settingsRef);
  if (!settingsSnapshot.exists()) {
    createdSettings = true;
    await setDoc(settingsRef, {
      organizationId,
      latitude: 10.7769,
      longitude: 106.7009,
      radiusMeters: 100,
      qrTtlSeconds: 45,
      maxDevicesPerEmployee: 1,
      earlyCheckInMinutes: 30,
      lateCheckInMinutes: 120,
      maxGpsAccuracyMeters: 80,
    });
  }

  const idToken = await credential.user.getIdToken();
  const response = await fetch(`${apiUrl}/v1/attendance/qr`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.error?.message || `Attendance API HTTP ${response.status}`);
  }
  const payload = JSON.parse(body.qrPayload);
  if (payload.version !== 1 || payload.organizationId !== organizationId || !payload.token) {
    throw new Error('Payload QR không hợp lệ.');
  }
  if (!Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now()) {
    throw new Error('Thời hạn QR không hợp lệ.');
  }
  console.log('ATTENDANCE_API_AUTH_OK');
  console.log('ATTENDANCE_QR_CREATED_OK');
  console.log('ATTENDANCE_QR_PAYLOAD_OK');
} finally {
  if (createdSettings) {
    await deleteDoc(doc(db, 'attendance_settings', organizationId));
  }
  await signOut(auth);
}

