import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_MONTHS, mergeById, monthStart } from '../src/services/managerData.js';

test('recent-history window starts on the first day of an earlier month', () => {
  assert.equal(monthStart(new Date(2026, 8, 25), 0), '2026-09-01');
  assert.equal(monthStart(new Date(2026, 8, 25), HISTORY_MONTHS - 1), '2026-07-01');
  assert.equal(monthStart(new Date(2026, 0, 3), 2), '2025-11-01');
});

test('loading an older month never overwrites records already in memory', () => {
  const merged = mergeById(
    [{ id: 'a', workHours: 9 }],
    [{ id: 'a', workHours: 8 }, { id: 'b', workHours: 4 }],
  );
  assert.deepEqual(merged, [{ id: 'a', workHours: 9 }, { id: 'b', workHours: 4 }]);
});
