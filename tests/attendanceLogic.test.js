import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAttendanceHours,
  deriveOvertimeHours,
  distanceMeters,
  isCheckInWithinWindow,
  isValidCoordinate,
  previousDate,
} from '../mail-server/src/attendanceLogic.js';

test('attendance check-in respects early and late limits', () => {
  const base = {
    scheduleDate: '2026-07-27',
    startTime: '08:00',
    earlyMinutes: 30,
    lateMinutes: 120,
  };
  assert.equal(isCheckInWithinWindow({ ...base, attemptedDate: '2026-07-27', attemptedTime: '07:29' }), false);
  assert.equal(isCheckInWithinWindow({ ...base, attemptedDate: '2026-07-27', attemptedTime: '07:30' }), true);
  assert.equal(isCheckInWithinWindow({ ...base, attemptedDate: '2026-07-27', attemptedTime: '10:00' }), true);
  assert.equal(isCheckInWithinWindow({ ...base, attemptedDate: '2026-07-27', attemptedTime: '10:01' }), false);
});

test('attendance window supports a late check-in after midnight', () => {
  assert.equal(isCheckInWithinWindow({
    scheduleDate: '2026-07-27',
    startTime: '23:30',
    attemptedDate: '2026-07-28',
    attemptedTime: '00:15',
    earlyMinutes: 30,
    lateMinutes: 120,
  }), true);
});

test('attendance derives the previous work date safely', () => {
  assert.equal(previousDate('2026-03-01'), '2026-02-28');
  assert.equal(previousDate('2026-01-01'), '2025-12-31');
});

test('rotating full-time overtime is based on actual daily duration', () => {
  assert.equal(deriveOvertimeHours({
    workHours: 10,
    employeeType: 'fulltime',
    workScheduleMode: 'rotating',
    standardHoursPerDay: 8,
    fixedOvertimeHours: 0,
  }), 2);
  assert.equal(deriveOvertimeHours({
    workHours: 7.5,
    employeeType: 'fulltime',
    workScheduleMode: 'rotating',
    standardHoursPerDay: 8,
    fixedOvertimeHours: 3,
  }), 0);
});

test('fixed-hours full-time keeps schedule-based overtime', () => {
  assert.equal(deriveOvertimeHours({
    workHours: 9,
    employeeType: 'fulltime',
    workScheduleMode: 'fixed',
    standardHoursPerDay: 8,
    fixedOvertimeHours: 1.25,
  }), 1.25);
});

test('attendance hours use the Vietnam clock for lateness and overtime', () => {
  // 08:10 -> 17:30 Vietnam time (UTC+7) on an 08:00-17:00 shift.
  const result = calculateAttendanceHours({
    checkInAt: new Date('2026-07-27T01:10:00.000Z'),
    checkOutAt: new Date('2026-07-27T10:30:00.000Z'),
    schedule: { startTime: '08:00', endTime: '17:00' },
    employeeProfile: { employeeType: 'parttime' },
  });
  assert.equal(result.workHours, 9.33);
  assert.equal(result.lateHours, 0.17);
  assert.equal(result.otHours, 0.5);
});

test('geofence helpers reject impossible coordinates and measure distance', () => {
  assert.equal(isValidCoordinate(10.77, 106.7), true);
  assert.equal(isValidCoordinate(91, 106.7), false);
  assert.equal(isValidCoordinate(Number.NaN, 106.7), false);
  const meters = distanceMeters(10.7769, 106.7009, 10.7778, 106.7009);
  assert.ok(meters > 95 && meters < 105);
});
