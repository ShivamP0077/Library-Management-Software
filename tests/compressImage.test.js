import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_TARGET_BYTES,
  ID_TARGET_BYTES,
  targetBytesFor,
  isPhotoDocument,
  compressImageDataUrl,
} from '../src/utils/compressImage.js';
import { prepareAttachment } from '../src/utils/attachmentUpload.js';

test('photo targets are smaller than ID targets', () => {
  assert.equal(targetBytesFor({ docType: 'Photograph' }), PHOTO_TARGET_BYTES);
  assert.equal(targetBytesFor({ name: 'doc-photo' }), PHOTO_TARGET_BYTES);
  assert.equal(targetBytesFor({ fileName: 'library/photo/front.jpg' }), PHOTO_TARGET_BYTES);
  assert.equal(isPhotoDocument({ purpose: 'Photograph' }), true);
  assert.equal(targetBytesFor({ docType: 'Aadhaar Card' }), ID_TARGET_BYTES);
  assert.equal(targetBytesFor({ docTypeId: 'doc-student-id', fileName: 'scan.jpg' }), ID_TARGET_BYTES);
  assert.equal(targetBytesFor({}), ID_TARGET_BYTES);
});

test('compression is a no-op without canvas or when disabled', async () => {
  const png = 'data:image/png;base64,AAAA';
  const missing = await compressImageDataUrl(png, { docType: 'Photograph' });
  assert.equal(missing.dataUrl, png);
  assert.equal(missing.compressed, false);
  assert.equal(missing.reason, 'no-canvas');

  const off = await compressImageDataUrl(png, { compress: false, docType: 'Photograph' });
  assert.equal(off.dataUrl, png);
  assert.equal(off.reason, 'disabled');

  const bad = await compressImageDataUrl('not-a-data-url', { docType: 'Photograph' });
  assert.equal(bad.dataUrl, 'not-a-data-url');
  assert.equal(bad.compressed, false);

  const pdf = await compressImageDataUrl('data:application/pdf;base64,AAAA');
  assert.equal(pdf.compressed, false);
  assert.equal(pdf.reason, 'not-raster');
});

test('prepareAttachment still returns the original data URL when compression cannot run', async () => {
  const prep = await prepareAttachment({
    file: { name: 'photo.jpg', type: 'image/jpeg', size: 8 },
    key: 'notice_photo',
    docType: 'Photograph',
    FileReaderImpl: class {
      readAsDataURL() { this.result = 'data:image/jpeg;base64,BBBB'; this.onload(); }
    },
  });
  assert.equal(prep.dataUrl, 'data:image/jpeg;base64,BBBB');
  assert.equal(prep.fileType, 'image/jpeg');
  assert.equal(prep.fileSize, 8);
});
