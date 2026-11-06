import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupStudentDocuments, addFilesToDocuments, replaceDocumentFile,
  removeDocumentFile, findDocumentGroup, allDocumentFiles, migrateLegacyDocuments,
} from '../src/utils/studentDocuments.js';
import { findPhotoDoc } from '../src/utils/studentPhoto.js';

const f = (key, name, type = 'image/png') => ({ id: key, storageKey: key, fileName: name, fileType: type, fileSize: 10, uploadedAt: '2026-11-06' });

test('#3: legacy single-file documents still read as a group', () => {
  const docs = [{ name: 'Aadhaar Card', storageKey: 'k1', fileName: 'front.png', fileType: 'image/png' }];
  const groups = groupStudentDocuments(docs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].files.length, 1);
  assert.equal(groups[0].files[0].storageKey, 'k1');
});

test('#3: multiple files per type are additive, other types remain', () => {
  let docs = addFilesToDocuments([], { name: 'Aadhaar Card', docTypeId: 'aadhaar', files: [f('k1', 'front.png')] });
  docs = addFilesToDocuments(docs, { name: 'Aadhaar Card', docTypeId: 'aadhaar', files: [f('k2', 'back.png')] });
  docs = addFilesToDocuments(docs, { name: 'PAN Card', docTypeId: 'pan', files: [f('k3', 'pan.pdf', 'application/pdf')] });
  const aadhaar = findDocumentGroup(docs, 'aadhaar');
  assert.deepEqual(aadhaar.files.map(x => x.storageKey), ['k1', 'k2']);
  assert.equal(findDocumentGroup(docs, 'pan').files[0].storageKey, 'k3');
  assert.equal(allDocumentFiles(docs).length, 3);
  // legacy fields mirror the first file
  assert.equal(aadhaar.storageKey, 'k1');
});

test('#3: replacing one file does not delete siblings or other categories', () => {
  let docs = addFilesToDocuments([], { name: 'Aadhaar', docTypeId: 'aadhaar', files: [f('k1', 'front.png'), f('k2', 'back.png')] });
  docs = addFilesToDocuments(docs, { name: 'PAN', docTypeId: 'pan', files: [f('k3', 'pan.pdf')] });
  const next = replaceDocumentFile(docs, 'aadhaar', 'k2', f('k4', 'back-new.png'));
  assert.deepEqual(findDocumentGroup(next, 'aadhaar').files.map(x => x.storageKey), ['k1', 'k4']);
  assert.equal(findDocumentGroup(next, 'pan').files[0].storageKey, 'k3');
});

test('#3: removing one file never removes collateral files', () => {
  let docs = addFilesToDocuments([], { name: 'Aadhaar', docTypeId: 'aadhaar', files: [f('k1', 'front.png'), f('k2', 'back.png')] });
  docs = addFilesToDocuments(docs, { name: 'PAN', docTypeId: 'pan', files: [f('k3', 'pan.pdf')] });
  const next = removeDocumentFile(docs, 'aadhaar', 'k2');
  assert.deepEqual(findDocumentGroup(next, 'aadhaar').files.map(x => x.storageKey), ['k1']);
  assert.equal(findDocumentGroup(next, 'pan').files[0].storageKey, 'k3');
  assert.equal(removeDocumentFile(docs, 'aadhaar', 'missing').length, 2);
});

test('#12/#3: photo lookup works inside files[] and legacy records', () => {
  const docs = [{
    name: 'Photograph', docTypeId: 'photo',
    files: [f('p1', 'me.jpg', 'image/jpeg'), f('p2', 'id.pdf', 'application/pdf')],
  }];
  assert.equal(findPhotoDoc({ documents: docs }).storageKey, 'p1');
  assert.equal(findPhotoDoc({ documents: [{ name: 'Photograph', storageKey: 'old', fileName: 'me.JPG' }] }).storageKey, 'old');
  assert.equal(findPhotoDoc({ documents: [{ name: 'Photograph', storageKey: 'pdf', fileName: 'a.pdf', fileType: 'application/pdf' }] }), null);
});

test('#3: legacy migration is idempotent and never loses a distinct top-level file', () => {
  const legacyWithFiles = {
    name: 'Aadhaar Card',
    docTypeId: 'dt-aadhaar',
    files: [f('k1', 'front.png')],
    storageKey: 'k-old-back',
    fileName: 'back-old.png',
    fileType: 'image/png',
  };
  const first = migrateLegacyDocuments([legacyWithFiles]);
  assert.deepEqual(first[0].files.map(x => x.storageKey), ['k1', 'k-old-back'], 'both files kept');
  const second = migrateLegacyDocuments(first);
  assert.deepEqual(second, first, 'second migration is a no-op');
});

test('#3: legacy name rows and new id rows are one type; other types are untouched', () => {
  const migrated = migrateLegacyDocuments([
    { name: 'Aadhaar Card', storageKey: 'legacy-a', fileName: 'a.png' },
    { name: 'PAN Card', storageKey: 'legacy-pan', fileName: 'pan.png' },
  ]);
  const afterAdd = addFilesToDocuments(migrated, { name: 'Aadhaar Card', docTypeId: 'dt-aadhaar', files: [f('new-a', 'new.png')] });
  const aadhaar = findDocumentGroup(afterAdd, 'dt-aadhaar');
  assert.deepEqual(aadhaar.files.map(x => x.storageKey), ['legacy-a', 'new-a']);
  assert.equal(findDocumentGroup(afterAdd, 'PAN Card').files[0].storageKey, 'legacy-pan');
  const removedOne = removeDocumentFile(afterAdd, 'dt-aadhaar', 'new-a');
  assert.deepEqual(findDocumentGroup(removedOne, 'Aadhaar Card').files.map(x => x.storageKey), ['legacy-a']);
  assert.equal(findDocumentGroup(removedOne, 'PAN Card').files[0].storageKey, 'legacy-pan');
});
