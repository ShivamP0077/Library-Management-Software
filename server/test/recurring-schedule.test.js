// Issue #8: firstDueDate + every N days / months / years.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { dueDatesFor, nthDueDate } from '../src/finance.js';

const dates = (t, until) => dueDatesFor(t, until).map(d => d.dueDate);

test('months keep the original day and clamp short months (Jan 31 -> Feb 28/29 -> Mar 31)', () => {
  assert.deepEqual(dates({ firstDueDate: '2027-01-31', intervalUnit: 'months', intervalCount: 1 }, '2027-04-30'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  assert.deepEqual(dates({ firstDueDate: '2028-01-31', intervalUnit: 'months', intervalCount: 1 }, '2028-03-31'), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.deepEqual(dates({ firstDueDate: '2026-11-30', intervalUnit: 'months', intervalCount: 3 }, '2027-12-31'), ['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30', '2027-11-30']);
});

test('years handle Feb 29 and days are exact', () => {
  assert.deepEqual(dates({ firstDueDate: '2028-02-29', intervalUnit: 'years', intervalCount: 1 }, '2032-12-31'), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  assert.deepEqual(dates({ firstDueDate: '2026-12-25', intervalUnit: 'days', intervalCount: 10 }, '2027-01-20'), ['2026-12-25', '2027-01-04', '2027-01-14']);
  assert.equal(nthDueDate('2026-02-28', 'days', 1, 1), '2026-03-01');
  assert.equal(nthDueDate('2028-02-28', 'days', 1, 1), '2028-02-29');
});

test('end date stops the schedule; legacy dueDay bills keep their old dates', () => {
  assert.deepEqual(dates({ firstDueDate: '2026-01-15', intervalUnit: 'months', intervalCount: 2, endDate: '2026-06-01' }, '2026-12-31'), ['2026-01-15', '2026-03-15', '2026-05-15']);
  assert.deepEqual(dates({ frequency: 'monthly', startDate: '2026-01-31', dueDay: 31 }, '2026-03-31'), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

const A = () => ctx.tokens.a;
before(() => setup('lms_recurring_schedule_test'));
after(teardown);

test('API: create with firstDueDate + unit, validation, generation uses the new schedule', async () => {
  const bad = await call('POST', '/api/recurring-expenses', { token: A(), body: { category: 'Rent', amount: 100, firstDueDate: '2026-11-10', intervalUnit: 'weeks', intervalCount: 1 } });
  assert.equal(bad.status, 400);
  const bad2 = await call('POST', '/api/recurring-expenses', { token: A(), body: { category: 'Rent', amount: 100, firstDueDate: '2026-11-10', intervalUnit: 'days', intervalCount: 0 } });
  assert.equal(bad2.status, 400);
  const r = await call('POST', '/api/recurring-expenses', { token: A(), body: { category: 'Water', amount: 300, firstDueDate: '2026-10-31', intervalUnit: 'months', intervalCount: 1 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = (await call('GET', '/api/recurring-expenses', { token: A() })).body;
  const t = list.find(x => x.category === 'Water');
  { assert.equal(t.firstDueDate, '2026-10-31'); assert.equal(t.intervalUnit, 'months'); assert.equal(t.frequency, 'interval'); }
  const inst = (await call('GET', '/api/expense-instances', { token: A() })).body;
  if (Array.isArray(inst)) for (const i of inst.filter(x => x.templateId === t.id)) assert.equal(i.dueDate.slice(8) === '31' || i.dueDate.slice(8) === '30', true);
});
