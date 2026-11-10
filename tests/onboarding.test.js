import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingSteps } from '../src/utils/onboarding.js';

test('a brand-new workspace starts with every step open', () => {
  const result = buildOnboardingSteps({ scheduleSettings: { shiftTemplates: [] } });
  assert.equal(result.completed, 0);
  assert.equal(result.total, 4);
  assert.equal(result.allRequiredDone, false);
  assert.equal(result.nextStep.key, 'location');
});

test('steps complete from real workspace data and point to the next one', () => {
  const result = buildOnboardingSteps({
    attendanceSettings: { latitude: '10.7769', longitude: '106.7009' },
    scheduleSettings: { shiftTemplates: [{ id: 'morning' }] },
    invitationCount: 1,
  });
  assert.equal(result.completed, 3);
  assert.equal(result.nextStep.key, 'first_checkin');
});

test('setup is finished after the first secure check-in; sales import stays optional', () => {
  const result = buildOnboardingSteps({
    attendanceSettings: { latitude: 10.7, longitude: 106.7 },
    scheduleSettings: { shiftTemplates: [{ id: 'morning' }] },
    employeeCount: 3,
    records: [{ secureAttendance: true }],
  });
  assert.equal(result.allRequiredDone, true);
  assert.equal(result.nextStep.key, 'sales');
});

test('blank or missing coordinates do not count as a saved location', () => {
  assert.equal(buildOnboardingSteps({ attendanceSettings: { latitude: '', longitude: '' } }).steps[0].done, false);
  assert.equal(buildOnboardingSteps({ attendanceSettings: { latitude: 10.7 } }).steps[0].done, false);
});
