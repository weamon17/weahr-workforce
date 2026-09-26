// Runs against the Firestore emulator: `npm run test:rules`.
// Exercises the real security rules instead of pattern-matching their source.
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
let env;

const users = {
  managerA: { role: 'manager', status: 'active', organizationId: ORG_A },
  employeeA1: { role: 'employee', status: 'active', organizationId: ORG_A },
  employeeA2: { role: 'employee', status: 'active', organizationId: ORG_A },
  suspendedA: { role: 'employee', status: 'suspended', organizationId: ORG_A },
  employeeB: { role: 'employee', status: 'active', organizationId: ORG_B },
};

const profiles = {
  employeeA1: { organizationId: ORG_A, userId: 'employeeA1', fullName: 'An', position: 'Pha chế', hourlyRate: 30000, skills: ['Pha chế', 'Thu ngân'], salary: 0, employeeType: 'parttime', employmentStatus: 'active' },
  // Legacy profile created before multi-skill support: no `skills` field.
  employeeA2: { organizationId: ORG_A, userId: 'employeeA2', fullName: 'Bình', position: 'Phục vụ', hourlyRate: 25000, salary: 0, employeeType: 'parttime', employmentStatus: 'active' },
  suspendedA: { organizationId: ORG_A, userId: 'suspendedA', fullName: 'Chi', position: 'Phục vụ', hourlyRate: 25000, salary: 0, employeeType: 'parttime', employmentStatus: 'suspended' },
};

const WEEK = '2026-09-28';
const shift = { id: '2026-09-28::morning', date: '2026-09-28', startTime: '07:00', endTime: '12:00', name: 'Ca sáng' };
const swapId = 'swap-1';
const openSwap = { organizationId: ORG_A, weekStart: WEEK, shift, fromEmployeeId: 'employeeA1', fromEmployeeName: 'An', status: 'open' };
const availability = (uid, overrides = {}) => ({
  organizationId: ORG_A,
  weekStart: WEEK,
  employeeId: uid,
  employeeName: profiles[uid].fullName,
  position: profiles[uid].position,
  hourlyRate: profiles[uid].hourlyRate,
  skills: profiles[uid].skills || [profiles[uid].position],
  selectedSlotIds: [shift.id],
  status: 'submitted',
  ...overrides,
});

const db = uid => env.authenticatedContext(uid).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-weahr',
    firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await Promise.all([
      ...Object.entries(users).map(([uid, data]) => setDoc(doc(admin, 'users', uid), data)),
      ...Object.entries(profiles).map(([uid, data]) => setDoc(doc(admin, 'employee_profiles', uid), data)),
      setDoc(doc(admin, 'timesheets', 'ts-a'), { organizationId: ORG_A, employeeId: 'employeeA1', date: '2026-09-25' }),
      setDoc(doc(admin, 'audit_logs', 'log-1'), { organizationId: ORG_A, action: 'edit' }),
      setDoc(doc(admin, 'shift_swap_requests', swapId), openSwap),
    ]);
  });
});

describe('tenant isolation', () => {
  test('an employee of another organization cannot read tenant data', async () => {
    await assertFails(getDoc(doc(db('employeeB'), 'timesheets', 'ts-a')));
    await assertFails(getDoc(doc(db('employeeB'), 'employee_profiles', 'employeeA1')));
  });

  test('employees read their own timesheet but cannot write attendance directly', async () => {
    await assertSucceeds(getDoc(doc(db('employeeA1'), 'timesheets', 'ts-a')));
    await assertFails(getDoc(doc(db('employeeA2'), 'timesheets', 'ts-a')));
    await assertFails(setDoc(doc(db('employeeA1'), 'timesheets', 'ts-new'), { organizationId: ORG_A, employeeId: 'employeeA1', date: '2026-09-26' }));
  });

  test('nobody can create a user profile or promote themselves from the client', async () => {
    await assertFails(setDoc(doc(db('newcomer'), 'users', 'newcomer'), { role: 'manager', status: 'active', organizationId: ORG_A }));
    await assertFails(updateDoc(doc(db('employeeA1'), 'users', 'employeeA1'), { role: 'manager' }));
  });
});

describe('employee profiles', () => {
  test('an active employee can edit contact details but not pay', async () => {
    await assertSucceeds(updateDoc(doc(db('employeeA1'), 'employee_profiles', 'employeeA1'), { phone: '0900000000' }));
    await assertFails(updateDoc(doc(db('employeeA1'), 'employee_profiles', 'employeeA1'), { hourlyRate: 90000 }));
  });

  test('a suspended employee cannot edit their profile', async () => {
    await assertFails(updateDoc(doc(db('suspendedA'), 'employee_profiles', 'suspendedA'), { phone: '0900000000' }));
  });
});

describe('weekly availability', () => {
  const id = uid => `${ORG_A}_${WEEK}_${uid}`;

  test('first-time employees can open pages whose documents do not exist yet', async () => {
    await assertSucceeds(getDoc(doc(db('employeeA1'), 'availability_submissions', id('employeeA1'))));
    await assertSucceeds(getDoc(doc(db('employeeA1'), 'weekly_assignments', id('employeeA1'))));
    await assertSucceeds(getDoc(doc(db('employeeA1'), 'schedule_settings', ORG_A)));
    await assertFails(getDoc(doc(db('employeeA1'), 'schedule_settings', ORG_B)));
  });

  test('submitted skills must match the manager-set profile', async () => {
    await assertSucceeds(setDoc(doc(db('employeeA1'), 'availability_submissions', id('employeeA1')), availability('employeeA1')));
    await assertFails(setDoc(doc(db('employeeA1'), 'availability_submissions', id('employeeA1')), availability('employeeA1', { skills: ['Pha chế', 'Thu ngân', 'Quản lý ca'] })));
    await assertFails(setDoc(doc(db('employeeA1'), 'availability_submissions', id('employeeA1')), availability('employeeA1', { hourlyRate: 99000 })));
  });

  test('legacy profiles without a skills list fall back to the position', async () => {
    await assertSucceeds(setDoc(doc(db('employeeA2'), 'availability_submissions', id('employeeA2')), availability('employeeA2')));
    await assertFails(setDoc(doc(db('employeeA2'), 'availability_submissions', id('employeeA2')), availability('employeeA2', { skills: ['Pha chế'] })));
  });

  test('an employee can resubmit after the manager changes their skills', async () => {
    const ref = doc(db('employeeA1'), 'availability_submissions', id('employeeA1'));
    await assertSucceeds(setDoc(ref, availability('employeeA1')));
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'employee_profiles', 'employeeA1'), { skills: ['Pha chế'] }));
    await assertSucceeds(setDoc(ref, availability('employeeA1', { skills: ['Pha chế'], selectedSlotIds: [] })));
  });
});

describe('shift swaps', () => {
  test('an employee can only offer their own shift as an open request', async () => {
    await assertSucceeds(setDoc(doc(db('employeeA2'), 'shift_swap_requests', 'swap-2'), { ...openSwap, fromEmployeeId: 'employeeA2' }));
    await assertFails(setDoc(doc(db('employeeA2'), 'shift_swap_requests', 'swap-3'), { ...openSwap, fromEmployeeId: 'employeeA2', status: 'approved' }));
    await assertFails(setDoc(doc(db('employeeA2'), 'shift_swap_requests', 'swap-4'), { ...openSwap }));
  });

  test('a colleague can claim, but never self-approve', async () => {
    const ref = doc(db('employeeA2'), 'shift_swap_requests', swapId);
    await assertFails(updateDoc(ref, { status: 'approved', claimedBy: 'employeeA2', claimedByName: 'Bình' }));
    await assertSucceeds(updateDoc(ref, { status: 'claimed', claimedBy: 'employeeA2', claimedByName: 'Bình' }));
  });

  test('claims from another organization or by the offering employee are rejected', async () => {
    await assertFails(updateDoc(doc(db('employeeB'), 'shift_swap_requests', swapId), { status: 'claimed', claimedBy: 'employeeB', claimedByName: 'X' }));
    await assertFails(updateDoc(doc(db('employeeA1'), 'shift_swap_requests', swapId), { status: 'claimed', claimedBy: 'employeeA1', claimedByName: 'An' }));
  });

  test('a rejected or cancelled offer can be reopened by its owner only', async () => {
    for (const status of ['rejected', 'cancelled']) {
      await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'shift_swap_requests', swapId), { ...openSwap, status }));
      await assertFails(setDoc(doc(db('employeeA2'), 'shift_swap_requests', swapId), { ...openSwap, fromEmployeeId: 'employeeA2' }));
      await assertSucceeds(setDoc(doc(db('employeeA1'), 'shift_swap_requests', swapId), openSwap));
    }
  });

  test('the manager approves swaps', async () => {
    await assertSucceeds(setDoc(doc(db('managerA'), 'shift_swap_requests', swapId), { status: 'approved' }, { merge: true }));
  });
});

describe('audit logs', () => {
  test('managers can add audit entries but nobody can delete or edit them', async () => {
    await assertSucceeds(setDoc(doc(db('managerA'), 'audit_logs', 'log-2'), { organizationId: ORG_A, action: 'edit' }));
    await assertFails(deleteDoc(doc(db('managerA'), 'audit_logs', 'log-1')));
    await assertFails(updateDoc(doc(db('managerA'), 'audit_logs', 'log-1'), { action: 'hidden' }));
    await assertFails(getDoc(doc(db('employeeA1'), 'audit_logs', 'log-1')));
  });
});
