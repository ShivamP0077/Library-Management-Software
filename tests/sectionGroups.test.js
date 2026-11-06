import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSeatTypesBySection, groupShiftsBySection } from '../src/utils/sectionGroups.js';

const sections = [{ id: 'A', name: 'Hall A' }, { id: 'B', name: 'Hall B' }];

test('seat types: own section, seat-derived sections, shared, unknown section', () => {
  const types = [{ id: 't1', name: 'AC', sectionId: 'A' }, { id: 't2', name: 'Fixed' }, { id: 't3', name: 'Floating' }, { id: 't4', name: 'Old', sectionId: 'Z' }];
  const seats = [{ seatTypeId: 't1', sectionId: 'A' }, { seatTypeId: 't2', sectionId: 'A' }, { seatTypeId: 't2', sectionId: 'B' }, { seatTypeId: 't2', blockId: 'B' }];
  const g = groupSeatTypesBySection(types, seats, sections);
  assert.deepEqual(g.map(x => x.title), ['Hall A', 'Hall B', 'All sections']);
  assert.deepEqual(g[0].items.map(i => [i.item.id, i.seatCount]), [['t1', 1], ['t2', 1]]);
  assert.deepEqual(g[1].items.map(i => [i.item.id, i.seatCount]), [['t2', 2]]);
  assert.deepEqual(g[2].items.map(i => i.item.id), ['t3', 't4']);
});

test('seat types: no sections means one shared group', () => {
  const g = groupSeatTypesBySection([{ id: 't1' }], [], []);
  assert.equal(g.length, 1); assert.equal(g[0].key, '__shared');
});

test('shifts: grouped by the sections of plans that use them', () => {
  const shifts = [{ id: 'sh1' }, { id: 'sh2' }, { id: 'sh3' }, { id: 'sh4' }];
  const plans = [{ shiftIds: ['sh1'], sectionId: 'A' }, { shiftIds: ['sh2'], sectionId: 'B' }, { shiftIds: ['sh2', 'sh3'] }];
  const g = groupShiftsBySection(shifts, plans, sections);
  assert.deepEqual(g.map(x => [x.title, x.items.map(i => i.item.id)]), [['Hall A', ['sh1']], ['Hall B', ['sh2']], ['All sections', ['sh2', 'sh3', 'sh4']]]);
});

test('inputs are not changed', () => {
  const types = [{ id: 't1', sectionId: 'A' }]; const snap = JSON.stringify(types);
  groupSeatTypesBySection(types, [], sections); assert.equal(JSON.stringify(types), snap);
});
