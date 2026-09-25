import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShiftSlots,
  generateWeeklyAssignments,
  getNextWeekStart,
  applyApprovedSwaps,
  getRegistrationDeadline,
} from '../src/utils/weeklyScheduler.js';

test('calculates the next Monday and the prior weekly deadline', () => {
  assert.equal(getNextWeekStart(new Date(2026, 6, 20)), '2026-07-27');
  assert.equal(getRegistrationDeadline('2026-07-27', 4, '18:00').getTime(), new Date(2026, 6, 24, 18, 0).getTime());
});

test('builds dated slots from reusable shift templates', () => {
  const slots = buildShiftSlots('2026-07-27', [{
    id: 'morning', name: 'Ca sáng', days: [0, 2], startTime: '07:00', endTime: '12:00', requiredEmployees: 2,
  }]);
  assert.deepEqual(slots.map(slot => slot.id), ['2026-07-27::morning', '2026-07-29::morning']);
});

test('fills scarce slots while distributing shifts fairly', () => {
  const slots = buildShiftSlots('2026-07-27', [{
    id: 'morning', name: 'Ca sáng', days: [0, 1], startTime: '07:00', endTime: '12:00', requiredEmployees: 1,
  }]);
  const result = generateWeeklyAssignments({
    slots,
    minShifts: 1,
    maxShifts: 2,
    submissions: [
      { employeeId: 'a', employeeName: 'An', selectedSlotIds: slots.map(slot => slot.id) },
      { employeeId: 'b', employeeName: 'Bình', selectedSlotIds: slots.map(slot => slot.id) },
    ],
  });
  assert.equal(result.totalAssigned, 2);
  assert.deepEqual(result.assignments.map(item => item.assignmentCount).sort(), [1, 1]);
  assert.equal(result.slots.reduce((sum, slot) => sum + slot.unfilled, 0), 0);
});

test('never assigns overlapping shifts to the same employee', () => {
  const slots = buildShiftSlots('2026-07-27', [
    { id: 'a', name: 'A', days: [0], startTime: '07:00', endTime: '12:00', requiredEmployees: 1 },
    { id: 'b', name: 'B', days: [0], startTime: '10:00', endTime: '15:00', requiredEmployees: 1 },
  ]);
  const result = generateWeeklyAssignments({
    slots,
    maxShifts: 3,
    submissions: [{ employeeId: 'a', employeeName: 'An', selectedSlotIds: slots.map(slot => slot.id) }],
  });
  assert.equal(result.assignments[0].assignmentCount, 1);
  assert.equal(result.slots.reduce((sum, slot) => sum + slot.unfilled, 0), 1);
});

const swapFixture = () => {
  const morning = { id: '2026-07-27::morning', name: 'Ca sáng', date: '2026-07-27', startTime: '07:00', endTime: '12:00', requiredEmployees: 1, employeeIds: ['an'], unfilled: 0 };
  const late = { id: '2026-07-27::late', name: 'Ca trưa', date: '2026-07-27', startTime: '10:00', endTime: '14:00', requiredEmployees: 1, employeeIds: ['binh'], unfilled: 0 };
  return {
    slots: [morning, late],
    assignments: [
      { employeeId: 'an', employeeName: 'An', slotIds: [morning.id], assignmentCount: 1, hourlyRate: 30000, estimatedCost: 150000 },
      { employeeId: 'binh', employeeName: 'Bình', slotIds: [late.id], assignmentCount: 1, hourlyRate: 40000, estimatedCost: 160000 },
    ],
    scheduleScore: 90,
  };
};

test('regeneration keeps an approved swap with the colleague who took the shift', () => {
  const result = applyApprovedSwaps(swapFixture(), [{
    status: 'approved', fromEmployeeId: 'an', claimedBy: 'chi', claimedByName: 'Chi',
    shift: { id: '2026-07-27::morning' },
  }]);
  const byId = Object.fromEntries(result.assignments.map(item => [item.employeeId, item]));
  assert.deepEqual(byId.an.slotIds, []);
  assert.deepEqual(byId.chi.slotIds, ['2026-07-27::morning']);
  assert.equal(byId.chi.employeeName, 'Chi');
  assert.deepEqual(result.slots.find(slot => slot.id === '2026-07-27::morning').employeeIds, ['chi']);
  assert.equal(byId.an.estimatedCost, 0);
  assert.equal(result.skippedSwaps.length, 0);
});

test('swaps that no longer fit the new schedule are reported, not forced', () => {
  const result = applyApprovedSwaps(swapFixture(), [
    // Bình already works an overlapping 10:00-14:00 shift.
    { status: 'approved', fromEmployeeId: 'an', claimedBy: 'binh', claimedByName: 'Bình', shift: { id: '2026-07-27::morning' } },
    // The offering employee no longer holds this shift.
    { status: 'approved', fromEmployeeId: 'an', claimedBy: 'chi', claimedByName: 'Chi', shift: { id: '2026-07-27::late' } },
    { status: 'open', fromEmployeeId: 'an', shift: { id: '2026-07-27::morning' } },
  ]);
  assert.equal(result.skippedSwaps.length, 2);
  assert.deepEqual(result.assignments.find(item => item.employeeId === 'an').slotIds, ['2026-07-27::morning']);
});
