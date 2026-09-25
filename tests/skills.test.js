import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeSkills, hasSkill, normalizeSkills } from '../src/utils/skills.js';
import { generateWeeklyAssignments } from '../src/utils/weeklyScheduler.js';

test('the position is always the first skill and duplicates are removed', () => {
  assert.deepEqual(normalizeSkills('Pha chế', ['Thu ngân', 'Pha chế', ' Thu ngân ', '']), ['Pha chế', 'Thu ngân']);
  assert.deepEqual(normalizeSkills('', []), []);
});

test('profiles without a skills list fall back to their position', () => {
  assert.deepEqual(employeeSkills({ position: 'Phục vụ' }), ['Phục vụ']);
  assert.deepEqual(employeeSkills({ position: 'Phục vụ', skills: ['Phục vụ', 'Thu ngân'] }), ['Phục vụ', 'Thu ngân']);
  assert.deepEqual(employeeSkills({}), []);
});

test('skill matching ignores case and treats an empty requirement as open', () => {
  assert.equal(hasSkill(['Pha chế'], 'pha chế'), true);
  assert.equal(hasSkill(['Pha chế'], 'Thu ngân'), false);
  assert.equal(hasSkill([], ''), true);
});

test('a multi-skilled employee can fill a shift outside their main position', () => {
  const slot = { id: 's1', date: '2026-07-27', startTime: '07:00', endTime: '12:00', requiredEmployees: 1, requiredSkill: 'Thu ngân' };
  const result = generateWeeklyAssignments({
    slots: [slot],
    submissions: [{ employeeId: 'a', employeeName: 'An', skills: ['Pha chế', 'Thu ngân'], selectedSlotIds: ['s1'] }],
  });
  assert.deepEqual(result.slots[0].employeeIds, ['a']);
});
