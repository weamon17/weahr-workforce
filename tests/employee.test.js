import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeDirectory, buildEmployeeDocumentId } from '../src/utils/employee.js';

test('employee document ids are tenant-scoped and Firestore-safe', () => {
  assert.equal(buildEmployeeDocumentId('quan-ca-phe', 'NV001'), 'quan-ca-phe_NV001');
  assert.equal(buildEmployeeDocumentId('chi nhánh Đà Nẵng', 'NV 001'), 'chi_nhanh_Da_Nang_NV_001');
  assert.notEqual(buildEmployeeDocumentId('org-a', 'NV001'), buildEmployeeDocumentId('org-b', 'NV001'));
});

test('employee document ids reject missing tenant identity', () => {
  assert.throws(() => buildEmployeeDocumentId('', 'NV001'));
  assert.throws(() => buildEmployeeDocumentId('org', ''));
});

test('employees who share a full name never overwrite each other', () => {
  const directory = buildEmployeeDirectory([], [
    { id: 'uid-an-1', data: { fullName: 'Nguyễn An', employeeCode: 'NV001', salary: 30000 } },
    { id: 'uid-an-2', data: { fullName: 'Nguyễn An', employeeCode: 'NV002', salary: 40000 } },
  ]);
  const entries = Object.values(directory);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(item => item.employeeId).sort(), ['uid-an-1', 'uid-an-2']);
  assert.equal(directory['Nguyễn An (NV002)'].salary, 40000);
});

test('accounts link to their HR record by UID before falling back to name', () => {
  const directory = buildEmployeeDirectory(
    [
      { id: 'org_a', data: { fullName: 'Trần Bình', employeeId: 'uid-binh', type: 'fulltime' } },
      { id: 'org_b', data: { fullName: 'Lê Chi', type: 'parttime' } },
    ],
    [
      { id: 'uid-binh', data: { fullName: 'Trần Bình' } },
      { id: 'uid-other-binh', data: { fullName: 'Trần Bình' } },
      { id: 'uid-chi', data: { fullName: 'Lê Chi' } },
    ],
  );
  assert.equal(directory['Trần Bình'].employeeId, 'uid-binh');
  assert.equal(directory['Trần Bình'].type, 'fulltime');
  assert.equal(Object.values(directory).filter(item => item.employeeId === 'uid-other-binh').length, 1);
  assert.equal(directory['Lê Chi'].employeeId, 'uid-chi');
  assert.equal(directory['Lê Chi'].employeeDocumentId, 'org_b');
});
