import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig, 'test-admin-verifier');
const auth = getAuth(app);
const db = getFirestore(app);
const email = String(process.env.TEST_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.TEST_ADMIN_PASSWORD || '');
const expectedOrganizationId = String(process.env.TEST_ORGANIZATION_ID || 'local-test');

const credential = await signInWithEmailAndPassword(auth, email, password);
try {
  if (!credential.user.emailVerified) throw new Error('Tài khoản test chưa được xác thực email.');

  const profileSnapshot = await getDoc(doc(db, 'users', credential.user.uid));
  if (!profileSnapshot.exists()) throw new Error('Không tìm thấy users profile.');
  const profile = profileSnapshot.data();
  if (profile.role !== 'manager' || profile.status !== 'active') {
    throw new Error('Tài khoản test không có quyền manager active.');
  }
  if (profile.organizationId !== expectedOrganizationId) {
    throw new Error('Tài khoản test thuộc sai organization.');
  }

  const organizationSnapshot = await getDoc(doc(db, 'organizations', expectedOrganizationId));
  if (!organizationSnapshot.exists()) throw new Error('Không tìm thấy workspace test.');

  const probeRef = doc(db, 'audit_logs', `test_admin_probe_${credential.user.uid}`);
  await setDoc(probeRef, {
    organizationId: expectedOrganizationId,
    action: 'local_test_admin_permission_probe',
    actorId: credential.user.uid,
    actorEmail: email,
    createdAt: serverTimestamp(),
  });
  const probeSnapshot = await getDoc(probeRef);
  if (!probeSnapshot.exists()) throw new Error('Không thể ghi dữ liệu bằng quyền manager.');
  await deleteDoc(probeRef);

  console.log('TEST_ADMIN_LOGIN_OK');
  console.log('TEST_ADMIN_PROFILE_OK');
  console.log('TEST_ADMIN_WRITE_DELETE_OK');
} finally {
  await signOut(auth);
}
