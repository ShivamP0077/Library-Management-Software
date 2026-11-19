import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { receiptDocument } from '../src/receiptPdf.js';

const settings = {
  name: 'Krishna Reading Room',
  address: '12 MG Road, Pune',
  phone: '020-12345678',
  taxId: '27ABCDE1234F1Z5',
  receiptFooter: 'Fees once paid are non-refundable. Keep this receipt for your records.',
};

const student = { name: 'Omdev Sharma', id: 'STU-S-1001', seatNo: 'P1' };

const paid = {
  receiptNo: 'REC-2026-001',
  studentId: 'STU-S-1001',
  studentName: 'Omdev Sharma',
  seatNo: 'P1',
  planName: 'Full Day Month Plan',
  paidOn: '2026-11-15',
  periodStart: '2026-11-15',
  periodEnd: '2026-12-14',
  nextDueDate: '2026-12-14',
  method: 'UPI',
  referenceNo: 'Hjvjvh',
  amount: 2000,
  discount: 0,
  fine: 0,
  netTotal: 2000,
  status: 'paid',
};

function textOf(buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rcpt-'));
  const file = path.join(dir, 'r.pdf');
  writeFileSync(file, buffer);
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

test('designed receipt is a real PDF much larger than the old text slip', async () => {
  const doc = await receiptDocument(paid, student, { settings });
  assert.equal(doc.mimetype, 'application/pdf');
  assert.equal(doc.fileName, 'REC-2026-001.pdf');
  assert.equal(doc.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(doc.base64, doc.buffer.toString('base64'));
  assert.ok(doc.buffer.length > 4000, `pdf was only ${doc.buffer.length} bytes`);
  const text = textOf(doc.buffer);
  for (const bit of [
    'Krishna Reading Room',
    '12 MG Road, Pune',
    '020-12345678',
    '27ABCDE1234F1Z5',
    'Omdev Sharma',
    'REC-2026-001',
    'Full Day Month Plan',
    '2026-11-15',
    '2026-12-14',
    'P1',
    'UPI',
    'Hjvjvh',
    '2,000',
    'STUDENT COPY',
    'PAID',
    'Powered by My Library OS',
  ]) {
    assert.match(text, new RegExp(bit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(text, /Concession/);
  assert.doesNotMatch(text, /Late Fine/);
});

test('omitted settings still produce a valid PDF', async () => {
  const doc = await receiptDocument(
    { receiptNo: 'R-1', method: 'Cash', amount: 100, netTotal: 100, status: 'paid' },
    { name: 'Asha' },
  );
  assert.equal(doc.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  const text = textOf(doc.buffer);
  assert.match(text, /My Library OS/);
  assert.match(text, /Asha/);
  assert.match(text, /R-1/);
});

test('library name is used when settings have no name', async () => {
  const doc = await receiptDocument(paid, student, { settings: {}, library: { name: 'Sunrise Library', phone: '011-1' } });
  const text = textOf(doc.buffer);
  assert.match(text, /Sunrise Library/);
  assert.match(text, /011-1/);
});

test('split payments list each method and reference', async () => {
  const doc = await receiptDocument({
    ...paid,
    method: 'Split',
    referenceNo: 'SHOULD-NOT-LEAD',
    breakdown: [
      { method: 'UPI', amount: 1500, referenceNo: 'UTR-A' },
      { method: 'Cash', amount: 500 },
    ],
  }, student, { settings });
  const text = textOf(doc.buffer);
  assert.match(text, /SPLIT/);
  assert.match(text, /UPI/);
  assert.match(text, /UTR-A/);
  assert.match(text, /Cash/);
  assert.doesNotMatch(text, /SHOULD-NOT-LEAD/);
});

test('discount and fine rows appear only when those amounts are above zero', async () => {
  const doc = await receiptDocument({
    ...paid,
    amount: 2500,
    discount: 400,
    fine: 100,
    netTotal: 2200,
    amountInWords: 'Two thousand two hundred only',
    status: 'partial',
    dueAmount: 300,
  }, student, { settings });
  const text = textOf(doc.buffer);
  assert.match(text, /Concession \/ Discount/);
  assert.match(text, /Late Fine/);
  assert.match(text, /400/);
  assert.match(text, /100/);
  assert.match(text, /2,200/);
  assert.match(text, /Due \/ remaining/);
  assert.match(text, /300/);
  assert.match(text, /Two thousand two hundred only/);
  assert.match(text, /PARTIAL PAYMENT/);
});

test('receipt PDF prints shipped default instructions when the field has never been set', async () => {
  const doc = await receiptDocument(paid, student, { settings });
  const text = textOf(doc.buffer);
  assert.match(text, /Instructions/);
  assert.match(text, /Fees once paid are non-refundable and non-transferable/);
  assert.match(text, /Please keep this receipt for your records/);
  assert.match(text, /Pay the next fee on or before the due date to keep your seat/);
  assert.match(text, /Maintain silence and keep the library clean/);
  assert.match(text, /The library is not responsible for personal belongings/);
  assert.match(text, /Fees once paid are non-refundable\. Keep this receipt for your records/);
});

test('receipt PDF uses custom instruction lines and still prints the footer note', async () => {
  const doc = await receiptDocument(paid, student, {
    settings: {
      ...settings,
      receiptInstructions: 'Fees are non-refundable.\nKeep this receipt for your records.\nLibrary timings: 6 AM - 11 PM',
    },
  });
  const text = textOf(doc.buffer);
  assert.match(text, /Instructions/);
  assert.match(text, /Fees are non-refundable\./);
  assert.match(text, /Keep this receipt for your records/);
  assert.match(text, /Library timings: 6 AM - 11 PM/);
  assert.doesNotMatch(text, /The library is not responsible for personal belongings/);
  assert.match(text, /Fees once paid are non-refundable\. Keep this receipt for your records/);
});

test('receipt PDF hides the Instructions box when receiptInstructions is cleared', async () => {
  const doc = await receiptDocument(paid, student, { settings: { ...settings, receiptInstructions: '' } });
  const text = textOf(doc.buffer);
  assert.doesNotMatch(text, /Instructions/);
  assert.doesNotMatch(text, /non-transferable/);
  assert.match(text, /Fees once paid are non-refundable\. Keep this receipt for your records/);
  assert.match(text, /Powered by My Library OS/);
});
