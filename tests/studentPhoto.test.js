import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPhotoDoc } from '../src/utils/studentPhoto.js';

test('findPhotoDoc picks an image named photo with a stored file', () => {
  assert.equal(findPhotoDoc(null), null);
  assert.equal(findPhotoDoc({ documents: [{ name: 'Aadhaar Card', storageKey: 'k', fileType: 'image/png' }] }), null);
  assert.equal(findPhotoDoc({ documents: [{ name: 'Photograph', fileType: 'image/png' }] }), null, 'needs a stored file');
  assert.equal(findPhotoDoc({ documents: [{ name: 'Photograph', storageKey: 'k', fileType: 'application/pdf', fileName: 'a.pdf' }] }), null);
  assert.equal(findPhotoDoc({ documents: [{ name: 'Photograph', storageKey: 'k1', fileName: 'me.JPG' }] }).storageKey, 'k1');
  assert.equal(findPhotoDoc({ documents: [{ name: 'ID' }, { name: 'Student photo', storageKey: 'k2', fileType: 'image/jpeg' }] }).storageKey, 'k2');
});
