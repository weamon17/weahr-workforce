import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHours,
  calculateLateHours,
  calculateNightHours,
  calculateOvertimeHours,
  localDateString,
  localMonthString,
} from '../src/utils/time.js';

test('calculates same-day and overnight work duration', () => {
  assert.equal(calculateHours('08:00', '17:30'), 9.5);
  assert.equal(calculateHours('22:00', '02:00'), 4);
  assert.equal(calculateHours('', '17:00'), 0);
});

test('late time never becomes a negative deduction', () => {
  assert.equal(calculateLateHours('08:00', '08:30'), 0.5);
  assert.equal(calculateLateHours('08:00', '07:45'), 0);
});

test('overtime includes time before and after the standard shift', () => {
  assert.equal(calculateOvertimeHours('08:00', '17:00', '07:30', '18:00'), 1.5);
  assert.equal(calculateOvertimeHours('22:00', '06:00', '22:00', '07:00'), 1);
});

test('local calendar date does not fall back to UTC in early morning', () => {
  // 06:30 on the 1st in local time is still the previous day in UTC for UTC+ zones.
  const earlyMorning = new Date(2026, 8, 1, 6, 30);
  assert.equal(localDateString(earlyMorning), '2026-09-01');
  assert.equal(localMonthString(earlyMorning), '2026-09');
});

test('night hours cover 22:00-06:00 including shifts across midnight', () => {
  assert.equal(calculateNightHours('08:00', '17:00'), 0);
  assert.equal(calculateNightHours('18:00', '23:30'), 1.5);
  assert.equal(calculateNightHours('21:00', '07:00'), 8);
  assert.equal(calculateNightHours('05:00', '09:00'), 1);
  assert.equal(calculateNightHours('', '09:00'), 0);
});
