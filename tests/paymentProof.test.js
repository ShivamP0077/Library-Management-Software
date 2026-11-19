import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentProofRefs, paymentProofModeOf, paymentProofsMissing, paymentProofModeChanged } from '../src/utils/paymentProof.js';
import { collectorIdentity, collectorRoleLabel } from '../src/utils/paymentCollector.js';

test('payment proof keeps image references and drops embedded bytes', () => {
  const refs = paymentProofRefs([
    { storageKey: 'payproof_1', fileName: 'counter.jpg', fileType: 'image/jpeg', fileSize: 1200, dataUrl: 'data:image/jpeg;base64,AAAA' },
    { storageKey: 'payproof_2', fileName: 'note.png', fileType: 'image/png' },
    { storageKey: 'payproof_3', fileName: 'scan.pdf', fileType: 'application/pdf' },
    { storageKey: 'data:image/png;base64,AAAA', fileName: 'inline.png', fileType: 'image/png' },
    null,
  ]);
  assert.deepEqual(refs, [
    { storageKey: 'payproof_1', fileName: 'counter.jpg', fileType: 'image/jpeg', fileSize: 1200 },
    { storageKey: 'payproof_2', fileName: 'note.png', fileType: 'image/png' },
  ]);
  assert.equal(paymentProofRefs(undefined).length, 0);
});

test('collector identity uses the signed-in user and never invents Admin', () => {
  assert.equal(collectorRoleLabel('client_admin'), 'Owner');
  assert.equal(collectorRoleLabel('staff', 'Librarian'), 'Librarian');
  assert.equal(collectorRoleLabel('staff'), 'Staff');
  assert.deepEqual(collectorIdentity({ id: 'u1', name: 'Meera', role: 'client_admin', email: 'm@x' }), {
    collectedByUserId: 'u1',
    collectedByName: 'Meera',
    collectedByRole: 'Owner',
    staffName: 'Meera',
  });
  assert.deepEqual(collectorIdentity({ id: 'u2', name: '   ', role: 'staff', email: 'desk@x' }, { staffRole: 'Librarian' }), {
    collectedByUserId: 'u2',
    collectedByName: 'desk@x',
    collectedByRole: 'Librarian',
    staffName: 'desk@x',
  });
  assert.deepEqual(collectorIdentity({ role: 'client_admin' }), { collectedByRole: 'Owner' });
});

test('payment proof mode defaults to Optional and detects a missing required proof', () => {
  assert.equal(paymentProofModeOf({}), 'OPTIONAL');
  assert.equal(paymentProofModeOf({ paymentProofMode: 'required' }), 'REQUIRED');
  assert.equal(paymentProofModeOf({ paymentProofMode: 'nope' }), 'OPTIONAL');
  assert.equal(paymentProofsMissing('REQUIRED', []), true);
  assert.equal(paymentProofsMissing('REQUIRED', [{ storageKey: 'payproof_1', fileType: 'image/jpeg' }]), false);
  assert.equal(paymentProofsMissing('OPTIONAL', []), false);
  assert.equal(paymentProofsMissing('OFF', []), false);
  assert.equal(paymentProofModeChanged({ paymentProofMode: 'OPTIONAL' }, { paymentProofMode: 'REQUIRED' }), true);
  assert.equal(paymentProofModeChanged({}, { paymentProofMode: 'optional' }), false);
});
