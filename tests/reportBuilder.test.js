import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_SECTIONS, parseReportSections, resolveDateRange, branchFilterState, sectionFilterState, matchesScope, paymentKind,
  reportDownloadFilename, contentDisposition, parseContentDisposition, formatReportMoney,
} from '../src/utils/reportBuilder.js';

test('section picker is only the approved list', () => {
  const labels = REPORT_SECTIONS.map(s => s.label);
  assert.deepEqual(labels, [
    'All Student Payments', 'Revenue', 'Expenses', 'Net Profit', 'New Students', 'Student List + Seat Numbers', 'Cancelled Students',
  ]);
  assert.equal(labels.some(l => /seat revenue|seat expenses/i.test(l)), false);
  assert.throws(() => parseReportSections('payments,seatRevenue'), /Unknown report section/);
  assert.throws(() => parseReportSections(['seatExpenses']), /Unknown report section/);
  assert.deepEqual(parseReportSections(''), REPORT_SECTIONS.map(s => s.id));
});

test('date presets and custom range', () => {
  const today = '2026-11-18';
  assert.deepEqual(resolveDateRange('last7', { today }), { preset: 'last7', from: '2026-11-12', to: today });
  assert.deepEqual(resolveDateRange('thisMonth', { today }), { preset: 'thisMonth', from: '2026-11-01', to: today });
  assert.deepEqual(resolveDateRange('lastMonth', { today }), { preset: 'lastMonth', from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(resolveDateRange('last2Months', { today }), { preset: 'last2Months', from: '2026-09-01', to: '2026-10-31' });
  assert.deepEqual(resolveDateRange('quarter', { today }), { preset: 'quarter', from: '2026-10-01', to: today });
  assert.deepEqual(resolveDateRange('year', { today }), { preset: 'year', from: '2026-01-01', to: today });
  assert.deepEqual(resolveDateRange('custom', { today, from: '2026-03-02', to: '2026-03-09' }), { preset: 'custom', from: '2026-03-02', to: '2026-03-09' });
  assert.deepEqual(resolveDateRange('lastMonth', { today: '2026-01-05' }), { preset: 'lastMonth', from: '2025-12-01', to: '2025-12-31' });
});

test('one branch or section is locked; several allow All', () => {
  const one = branchFilterState([{ id: 'b1', name: 'Main' }]);
  assert.equal(one.locked, true);
  assert.equal(one.value, 'b1');
  assert.equal(one.allowAll, false);
  const many = branchFilterState([{ id: 'b1' }, { id: 'b2' }]);
  assert.equal(many.locked, false);
  assert.equal(many.value, 'all');
  assert.equal(many.allowAll, true);
  const none = sectionFilterState([]);
  assert.equal(none.locked, true);
  assert.equal(none.value, 'all');
  const secs = sectionFilterState([{ id: 's1', branchId: 'b1' }, { id: 's2', branchId: 'b2' }], 'b1');
  assert.equal(secs.locked, true);
  assert.equal(secs.value, 's1');
  const both = sectionFilterState([{ id: 's1', branchId: 'b1' }, { id: 's2', branchId: 'b1' }], 'b1');
  assert.equal(both.locked, false);
  assert.equal(both.allowAll, true);
});

test('shared rows count only when the filter is All', () => {
  assert.equal(matchesScope('all', 'all'), true);
  assert.equal(matchesScope('all', 'b1'), false);
  assert.equal(matchesScope(undefined, 'b1'), false);
  assert.equal(matchesScope('shared', 'b2'), false);
  assert.equal(matchesScope('b1', 'b1'), true);
  assert.equal(matchesScope('b1', 'b2'), false);
  const expenses = [
    { id: 'shared', amount: 200, branchId: 'all' },
    { id: 'a', amount: 40, branchId: 'b1' },
    { id: 'b', amount: 25, branchId: 'b2' },
  ];
  const sum = (filter) => expenses.filter(e => matchesScope(e.branchId, filter)).reduce((a, e) => a + e.amount, 0);
  assert.equal(sum('all'), 265);
  assert.equal(sum('b1') + sum('b2') + 200, sum('all'));
  assert.equal(sum('b1'), 40);
});

test('report file names, money, and content disposition', () => {
  assert.equal(reportDownloadFilename({
    libraryName: 'Accomplish Reading Zone',
    branchName: 'Main Branch',
    branchId: 'main',
    sections: ['Revenue', 'Expenses'],
    from: '2026-11-01',
    to: '2026-11-19',
    ext: 'pdf',
  }), 'Accomplish_Reading_Zone_Main_Branch_Combined_Report_01Nov-19Nov2026.pdf');
  assert.equal(reportDownloadFilename({
    libraryName: 'Accomplish Reading Zone',
    branchId: 'all',
    sections: ['payments'],
    from: '2026-11-01',
    to: '2026-11-19',
    ext: 'csv',
  }), 'Accomplish_Reading_Zone_All_Branches_All_Student_Payments_01Nov-19Nov2026.csv');
  assert.equal(reportDownloadFilename({
    libraryName: 'Library A',
    branchName: 'Main Branch',
    branchId: 'b1',
    sections: ['Revenue'],
    from: '2025-11-01',
    to: '2026-11-19',
    ext: 'xlsx',
  }), 'Library_A_Main_Branch_Revenue_01Nov2025-19Nov2026.xlsx');
  const byId = reportDownloadFilename({
    libraryName: 'Library X',
    branchId: 'b1',
    sections: ['revenue'],
    from: '2026-11-01',
    to: '2026-11-19',
    ext: 'pdf',
  });
  assert.match(byId, /_b1_/);
  assert.equal(byId.includes('All_Branches'), false);
  assert.equal(formatReportMoney(800), '₹800');
  assert.equal(formatReportMoney(1234), '₹1,234');
  assert.equal(formatReportMoney(-100), '-₹100');
  const named = 'Accomplish_Reading_Zone_Main_Branch_Combined_Report_01Nov-19Nov2026.pdf';
  const header = contentDisposition(named);
  assert.equal(parseContentDisposition(header), named);
  assert.match(header, /filename\*=UTF-8''/);
  assert.equal(parseContentDisposition(`attachment; filename="wrong.pdf"; filename*=UTF-8''${encodeURIComponent('Café_Report.pdf')}`), 'Café_Report.pdf');
  assert.match(contentDisposition('Café_Report.pdf'), /filename="Caf._Report.pdf"/);
});

test('refunds and cancellations stay distinct from collections', () => {
  assert.equal(paymentKind({ method: 'UPI', netTotal: 500 }), 'Collection');
  assert.equal(paymentKind({ method: 'Refund', netTotal: -100 }), 'Refund');
  assert.equal(paymentKind({ method: 'Cash', netTotal: -50 }), 'Refund');
  assert.equal(paymentKind({ method: 'Cancellation', netTotal: 0 }), 'Cancellation');
  assert.equal(paymentKind({ method: 'Cash', netTotal: 10, voided: true }), 'Voided');
});
