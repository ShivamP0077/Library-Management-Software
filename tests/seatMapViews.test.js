import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEAT_COLORS,
  deskPaymentState,
  filterPhotoTiles,
  occupancyStatusClass,
  paymentStatusClass,
} from '../src/utils/seatMapViews.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('payment view marks a shared desk mixed only when states differ', () => {
  assert.equal(deskPaymentState([]), 'unassigned');
  assert.equal(deskPaymentState([{ paymentStatus: 'paid' }]), 'paid');
  assert.equal(deskPaymentState([{ dueAmount: 50 }]), 'unpaid');
  assert.equal(deskPaymentState([{ paymentStatus: 'paid' }, { paymentStatus: 'unpaid' }]), 'mixed');
  assert.equal(deskPaymentState([{ paymentStatus: 'paid' }, { paymentStatus: 'paid' }]), 'paid');
  assert.equal(paymentStatusClass('mixed'), 'seat-mixed');
  assert.equal(occupancyStatusClass({ isOccupied: true, gender: 'Female' }), 'seat-occupied-female');
  assert.equal(occupancyStatusClass({ isMaintenance: true, isOccupied: true }), 'seat-maintenance');
});

test('photo search filters by name or desk', () => {
  const tiles = [
    { name: 'Asha Rao', desk: '12', id: 'S1' },
    { name: 'Dev Patel', desk: '4', id: 'S2' },
  ];
  assert.equal(filterPhotoTiles(tiles, '').length, 2);
  assert.equal(filterPhotoTiles(tiles, 'asha')[0].desk, '12');
  assert.equal(filterPhotoTiles(tiles, 'desk 4').length, 0);
  assert.equal(filterPhotoTiles(tiles, '4')[0].name, 'Dev Patel');
});

test('seat map exposes three views with solid hex fills and white numbers', () => {
  const jsx = read('../src/components/SeatMap.jsx');
  const css = read('../src/index.css');
  const views = read('../src/utils/seatMapViews.js');
  assert.match(views, /label: 'Occupancy'/);
  assert.match(views, /label: 'Payment'/);
  assert.match(views, /label: 'Photo'/);
  assert.match(jsx, /SEAT_MAP_VIEWS/);
  assert.match(jsx, /aria-label="Seat map view"/);
  assert.match(jsx, /seat-legend/);
  assert.match(jsx, /seat-photo-tile/);
  assert.match(jsx, /seat-photo-name/);
  assert.match(jsx, /seat-photo-desk/);
  assert.match(jsx, /Student Details/);
  assert.match(jsx, /Seat Details/);
  assert.match(jsx, /No photo/);
  assert.match(jsx, /Search photo tiles/);
  assert.match(jsx, /holdsDesk\(student, settings, todayIST\(\)\)/);
  assert.doesNotMatch(jsx, />Current</);

  for (const hex of Object.values(SEAT_COLORS.occupancy)) {
    assert.match(css, new RegExp(hex));
  }
  for (const hex of Object.values(SEAT_COLORS.payment)) {
    assert.match(css, new RegExp(hex));
  }
  assert.match(css, /\.seat-3d \.seat-number \{ color: #ffffff/);
  assert.match(css, /\.seat-occupied-male \{ background: #2563eb/);
  assert.match(css, /\.seat-occupied-female \{ background: #db2777/);
  assert.match(css, /\.seat-available \{ background: #16a34a/);
  assert.match(css, /\.seat-paid \{ background: #16a34a/);
  assert.match(css, /\.seat-unpaid \{ background: #dc2626/);
  assert.match(css, /\.seat-mixed \{ background: #eab308/);
  assert.match(css, /\.seat-unassigned \{ background: #9ca3af/);
  assert.doesNotMatch(css, /\.seat-occupied-male \{ background: #eff6ff/);
});
