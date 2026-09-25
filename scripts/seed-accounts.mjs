/**
 * One-time script: tạo tài khoản test cho WeaHR
 * Chạy: node scripts/seed-accounts.mjs
 */
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const missingFirebaseConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missingFirebaseConfig.length) {
  throw new Error(`Thiếu Firebase config trong .env.local: ${missingFirebaseConfig.join(', ')}`);
}

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const organizationId = process.env.DEFAULT_ORGANIZATION_ID || 'demo';

// ─────────────────────────────────────────────
// Tài khoản QUẢN LÝ (Manager)
// ─────────────────────────────────────────────
async function createManager() {
  const email    = 'admin@whr.test';
  const password = 'Admin@123456';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    await setDoc(doc(db, 'users', uid), {
      uid,
      email,
      role: 'manager',
      organizationId,
      displayName: 'Admin WeaHR',
      createdAt: new Date().toISOString(),
    });

    console.log('✅ Quản lý:');
    console.log(`   Email   : ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   UID     : ${uid}\n`);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      console.log(`⚠️  Quản lý đã tồn tại (${email}) — bỏ qua.\n`);
    } else {
      console.error('❌ Lỗi tạo quản lý:', err.message);
    }
  }
}

// ─────────────────────────────────────────────
// Tài khoản NHÂN VIÊN Part-time
// ─────────────────────────────────────────────
async function createEmployee(opts) {
  const { email, password, fullName, type, salary, hourlyRate, position, standardStart, standardEnd, overtimeRate, freeOffDays } = opts;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    // users collection — xác định role
    await setDoc(doc(db, 'users', uid), {
      uid,
      email,
      role: 'employee',
      organizationId,
      createdAt: new Date().toISOString(),
    });

    // employee_profiles — dùng bởi Employee Portal
    await setDoc(doc(db, 'employee_profiles', uid), {
      userId:            uid,
      organizationId,
      fullName,
      email,
      dateOfBirth:       '2000-01-15',
      citizenId:         '012345678901',
      address:           '123 Đường Nguyễn Huệ, Quận 1, TP.HCM',
      phone:             '0901234567',
      employeeType:      type,          // 'parttime' | 'fulltime'
      position,
      employmentStatus:  'active',
      startDate:         '2024-06-01',
      salary:            salary  || 0,
      hourlyRate:        hourlyRate || 0,
      standardWorkDays:  26,
      standardHoursPerDay: 8,
      freeOffDays:       freeOffDays ?? 2,
      overtimeRate:      overtimeRate  ?? 1.5,
      standardStart:     standardStart || '08:00',
      standardEnd:       standardEnd   || '17:00',
    });

    // employees collection — dùng bởi Manager (TimesheetTab, PayrollTab)
    await setDoc(doc(db, 'employees', fullName), {
      employeeId:  uid,
      organizationId,
      type,
      salary:        salary  || hourlyRate || 0,
      hourlyRate:    hourlyRate || 0,
      standardStart: standardStart || '08:00',
      standardEnd:   standardEnd   || '17:00',
      overtimeRate:  overtimeRate  ?? 1.5,
      freeOffDays:   freeOffDays   ?? 2,
      standardHoursPerDay: 8,
    });

    console.log(`✅ Nhân viên (${type === 'parttime' ? 'Part-time' : 'Full-time'}): ${fullName}`);
    console.log(`   Email   : ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   UID     : ${uid}\n`);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      console.log(`⚠️  Nhân viên đã tồn tại (${email}) — bỏ qua.\n`);
    } else {
      console.error(`❌ Lỗi tạo ${email}:`, err.message);
    }
  }
}

// ─────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   WeaHR — Tạo tài khoản test         ║');
  console.log('╚══════════════════════════════════════╝\n');

  await createManager();
  await signOut(auth);

  await createEmployee({
    email:        'nv.parttime@whr.test',
    password:     'NhanVien@123',
    fullName:     'Trần Thị Mai',
    type:         'parttime',
    hourlyRate:   30000,
    position:     'Phục vụ',
    standardStart:'07:00',
    standardEnd:  '15:00',
  });
  await signOut(auth);

  await createEmployee({
    email:        'nv.fulltime@whr.test',
    password:     'NhanVien@123',
    fullName:     'Nguyễn Văn Hùng',
    type:         'fulltime',
    salary:       8000000,
    position:     'Pha chế',
    standardStart:'08:00',
    standardEnd:  '17:00',
    overtimeRate: 1.5,
    freeOffDays:  2,
  });
  await signOut(auth);

  console.log('════════════════════════════════════════');
  console.log('🎉 Xong! Thông tin đăng nhập:');
  console.log('');
  console.log('  [QUẢN LÝ]');
  console.log('  Email   : admin@whr.test');
  console.log('  Password: Admin@123456');
  console.log('');
  console.log('  [NHÂN VIÊN - Part-time]');
  console.log('  Email   : nv.parttime@whr.test');
  console.log('  Password: NhanVien@123');
  console.log('  Tên     : Trần Thị Mai');
  console.log('');
  console.log('  [NHÂN VIÊN - Full-time]');
  console.log('  Email   : nv.fulltime@whr.test');
  console.log('  Password: NhanVien@123');
  console.log('  Tên     : Nguyễn Văn Hùng');
  console.log('════════════════════════════════════════');

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
