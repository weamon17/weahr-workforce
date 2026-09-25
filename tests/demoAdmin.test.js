import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoAdminSession } from '../src/demo/demoAdmin.js';

test('creates an isolated verified local admin demo with useful sample data', () => {
  const demo = createDemoAdminSession('admin@weahr.local');
  assert.equal(demo.currentUser.emailVerified, true);
  assert.equal(demo.userProfile.role, 'manager');
  assert.equal(demo.userProfile.organizationId, 'demo-org');
  assert.ok(Object.keys(demo.employees).length >= 2);
  assert.ok(demo.records.length >= 3);
  assert.ok(demo.schedules.some(item => item.status === 'pending'));
  assert.ok(demo.salesRecords.length >= 28);
  assert.ok(demo.salesRecords.every(item => item.organizationId === 'demo-org'));
});
