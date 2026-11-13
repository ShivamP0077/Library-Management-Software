import test from 'node:test';
import assert from 'node:assert/strict';
import {
  occurrenceKey, partitionActions, skipItem, snoozeItem, normalizeDismissals, nextLocalDay, MAX_SKIPS,
} from '../src/utils/actionDismissals.js';

const student = (expiry) => ({
  id: 'n1',
  category: 'students',
  body: `Plan ends ${expiry}`,
  link: { tab: 'students', params: { student: 'S1' } },
});

test('occurrence key includes type, student and expiry so a new period comes back', () => {
  const june = occurrenceKey(student('2026-06-30'));
  const july = occurrenceKey(student('2026-07-31'));
  assert.equal(june, 'students|S1|2026-06-30');
  assert.notEqual(june, july);
  const expense = occurrenceKey({
    id: 'n2', category: 'expenses', body: '₹500 pending (due 2026-06-01)',
    link: { params: { 'expense-instance': 'bill-9' } },
  });
  assert.equal(expense, 'expenses|bill-9|2026-06-01');
});

test('Skip hides this occurrence only; Later hides until the next local day', () => {
  const today = '2026-11-13';
  const item = student('2026-11-30');
  const later = snoozeItem({ snoozes: [], skips: [] }, item, today);
  assert.equal(later.snoozes[0].until, nextLocalDay(today));
  let view = partitionActions([item, student('2026-12-31')], later, today);
  assert.equal(view.shown.length, 1);
  assert.equal(view.hidden.length, 1);
  view = partitionActions([item], later, '2026-11-14');
  assert.equal(view.shown.length, 1, 'visible again the next day');
  assert.equal(view.dismissals.snoozes.length, 0, 'past snooze is pruned');

  const skipped = skipItem({ snoozes: [], skips: [] }, item, today);
  view = partitionActions([item], skipped, '2026-12-01');
  assert.equal(view.hidden.length, 1);
  view = partitionActions([student('2027-01-31')], skipped, '2027-01-01');
  assert.equal(view.shown.length, 1);
});

test('stored skips stay capped at the newest 500 and past snoozes are dropped', () => {
  const skips = Array.from({ length: MAX_SKIPS + 20 }, (_, i) => ({ key: `students|S${i}|2026-01-01`, at: '2026-11-01' }));
  const stored = normalizeDismissals({
    snoozes: [{ key: 'students|old|2026-01-01', until: '2026-11-01' }, { key: 'students|soon|2026-02-01', until: '2026-11-20' }],
    skips,
  }, '2026-11-13');
  assert.equal(stored.skips.length, MAX_SKIPS);
  assert.equal(stored.skips[stored.skips.length - 1].key, `students|S${MAX_SKIPS + 19}|2026-01-01`);
  assert.equal(stored.skips.some(s => s.key === 'students|S0|2026-01-01'), false);
  assert.deepEqual(stored.snoozes, [{ key: 'students|soon|2026-02-01', until: '2026-11-20' }]);
});
