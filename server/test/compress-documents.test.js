import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { assertLocalMongoUri, resolveLocalMongoUri, DEFAULT_LOCAL_URI } from '../scripts/lib/local-mongo.mjs';
import { classifyDocument, compressImageBuffer, parseDataUrl, toDataUrl } from '../scripts/lib/compress-image-buffer.mjs';

test('mongo uri guard allows only localhost', () => {
  assert.equal(assertLocalMongoUri('mongodb://127.0.0.1:27017/library_management'), 'mongodb://127.0.0.1:27017/library_management');
  assert.equal(assertLocalMongoUri('mongodb://localhost:27017/library_management'), 'mongodb://localhost:27017/library_management');
  assert.equal(
    assertLocalMongoUri('mongodb://reader:secret@127.0.0.1:27017/library_management?authSource=admin'),
    'mongodb://reader:secret@127.0.0.1:27017/library_management?authSource=admin',
  );
  assert.equal(resolveLocalMongoUri({}), DEFAULT_LOCAL_URI);
  for (const uri of [
    'mongodb+srv://user:pw@cluster0.example.mongodb.net/library_management',
    'mongodb://cluster0.example.mongodb.net:27017/library_management',
    'mongodb://10.1.2.3:27017/library_management',
    'mongodb://127.0.0.1:27017,db.internal:27017/library_management',
    'http://127.0.0.1:27017',
  ]) {
    assert.throws(() => assertLocalMongoUri(uri), /Refusing/);
  }
});

test('photo vs id classification matches document names', () => {
  assert.equal(classifyDocument({ docTypeId: 'Photograph' }).targetBytes, 200 * 1024);
  assert.equal(classifyDocument({ fileName: 'doc-photo.jpg' }).kind, 'photo');
  assert.equal(classifyDocument({ storageKey: 'lib/photo/1' }).kind, 'photo');
  assert.equal(classifyDocument({ docTypeId: 'Aadhaar Card' }).targetBytes, 500 * 1024);
  assert.equal(classifyDocument({ docTypeId: 'doc-student-id' }).kind, 'id');
});

test('jpeg recompress shrinks a large photo and keeps data-url form', async () => {
  const width = 1800;
  const height = 1400;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 47) raw[i] = (i * 17) % 256;
  const big = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  assert.ok(big.length > 200 * 1024, `fixture was ${big.length} bytes`);
  const result = await compressImageBuffer(big, 'image/jpeg', { docTypeId: 'Photograph', fileName: 'photo.jpg' });
  assert.equal(result.action, 'compress');
  assert.equal(result.mime, 'image/jpeg');
  assert.ok(result.afterBytes < result.beforeBytes);
  assert.ok(result.afterBytes <= 200 * 1024, `compressed to ${result.afterBytes}`);
  const url = toDataUrl(result.mime, result.buf);
  assert.match(url, /^data:image\/jpeg;base64,/);
  const parsed = parseDataUrl(url);
  assert.equal(parsed.buf.length, result.buf.length);
  const again = await compressImageBuffer(result.buf, result.mime, { docTypeId: 'Photograph', compressedAt: new Date() });
  assert.equal(again.action, 'skip');
  assert.equal(again.reason, 'already-compressed');
});

test('pdf and garbage payloads are skipped', async () => {
  const pdf = await compressImageBuffer(Buffer.from('%PDF-1.4'), 'application/pdf', { fileName: 'a.pdf' });
  assert.equal(pdf.action, 'skip');
  assert.equal(pdf.reason, 'pdf');
  const bad = await compressImageBuffer(Buffer.from('not-an-image'), 'image/jpeg', { docTypeId: 'Aadhaar Card' });
  assert.equal(bad.action, 'skip');
  assert.equal(bad.reason, 'invalid-image');
  assert.equal(parseDataUrl('hello'), null);
});
