import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_LIMIT_TITLE, deskLimitExceededCopy } from '../src/utils/planLimitCopy.js';

test('desk growth copy names Plan Limit Exceeded and Upgrade', () => {
  const msg = deskLimitExceededCopy(100, 1, 100);
  assert.match(msg, new RegExp(PLAN_LIMIT_TITLE));
  assert.match(msg, /Upgrade/);
  assert.match(msg, /100 physical desks/);
  assert.equal(deskLimitExceededCopy(99, 1, 100), null);
  assert.equal(deskLimitExceededCopy(120, 0, 100), null);
  assert.equal(deskLimitExceededCopy(120, -1, 100), null);
  assert.equal(deskLimitExceededCopy(5, 1, null), null);
});
