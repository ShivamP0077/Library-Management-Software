import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { todayIn } from '../src/finance.js';
import { addDays } from '../../src/utils/billingCycle.js';
import { MAX_SKIPS } from '../../src/utils/actionDismissals.js';

const A = () => ctx.tokens.a;
const B = () => ctx.tokens.b;
before(() => setup('lms_action_dismiss_test'));
after(teardown);

test('action dismissals are tenant scoped, validated, pruned and capped', async () => {
  const today = todayIn();
  const empty = await call('GET', '/api/dashboard/action-dismissals', { token: A() });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { snoozes: [], skips: [] });

  const bad = await call('PUT', '/api/dashboard/action-dismissals', { token: A(), body: { snoozes: 'later', skips: [] } });
  assert.equal(bad.status, 400);

  const badDate = await call('PUT', '/api/dashboard/action-dismissals', {
    token: A(),
    body: { snoozes: [{ key: 'students|S1|2026-11-30', until: 'tomorrow' }], skips: [] },
  });
  assert.equal(badDate.status, 400);

  const skips = Array.from({ length: MAX_SKIPS + 5 }, (_, i) => ({ key: `students|S${i}|2026-06-30`, at: today }));
  const saved = await call('PUT', '/api/dashboard/action-dismissals', {
    token: A(),
    body: {
      snoozes: [
        { key: 'students|S9|2026-01-01', until: addDays(today, -1) },
        { key: 'students|S9|2026-11-30', until: addDays(today, 1) },
      ],
      skips,
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.skips.length, MAX_SKIPS);
  assert.equal(saved.body.skips.some(s => s.key === 'students|S0|2026-06-30'), false);
  assert.equal(saved.body.skips.at(-1).key, `students|S${MAX_SKIPS + 4}|2026-06-30`);
  assert.deepEqual(saved.body.snoozes, [{ key: 'students|S9|2026-11-30', until: addDays(today, 1) }]);

  const other = await call('GET', '/api/dashboard/action-dismissals', { token: B() });
  assert.equal(other.status, 200);
  assert.deepEqual(other.body, { snoozes: [], skips: [] });

  const again = await call('GET', '/api/dashboard/action-dismissals', { token: A() });
  assert.equal(again.body.skips.length, MAX_SKIPS);
  assert.equal(again.body.snoozes.length, 1);

  const cross = await call('PUT', '/api/dashboard/action-dismissals', {
    token: B(),
    body: { snoozes: [], skips: [{ key: 'students|ONLY-B|2026-06-30', at: today }] },
  });
  assert.equal(cross.status, 200);
  const stillA = await call('GET', '/api/dashboard/action-dismissals', { token: A() });
  assert.equal(stillA.body.skips.some(s => s.key.includes('ONLY-B')), false);
  assert.equal(stillA.body.skips.length, MAX_SKIPS);
});

test('saving library settings never wipes Skip / Later', async () => {
  const today = todayIn();
  const put = await call('PUT', '/api/dashboard/action-dismissals', {
    token: A(),
    body: { snoozes: [], skips: [{ key: 'students|KEEP|2026-12-31', at: today }] },
  });
  assert.equal(put.status, 200);
  const settings = await call('PUT', '/api/settings', { token: A(), body: { name: 'Renamed library', actionDismissals: { snoozes: [], skips: [] } } });
  assert.equal(settings.status, 200);
  const after = await call('GET', '/api/dashboard/action-dismissals', { token: A() });
  assert.equal(after.body.skips.some(s => s.key === 'students|KEEP|2026-12-31'), true);
});
