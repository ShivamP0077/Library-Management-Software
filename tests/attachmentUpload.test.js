import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextBackoffDelay, isRetryableRequestError, friendlyRequestError, withTimeout,
} from '../src/utils/boundedRequest.js';
import {
  validateAttachment as validateFile, mimeOf, isPdfAttachment, makeAttachmentKey,
  uploadAttachmentData as uploadData, prepareAttachment,
} from '../src/utils/attachmentUpload.js';

const fakeFile = (name, type, size = 10) => ({ name, type, size });

test('#3/#22: file type and size validation', () => {
  assert.equal(validateFile(fakeFile('a.pdf', 'application/pdf', 1000)).ok, true);
  assert.equal(validateFile(fakeFile('a.jpg', 'image/jpeg', 1000)).ok, true);
  assert.equal(validateFile(fakeFile('scan', '', 1000)).code, 'type', 'no extension/type is rejected');
  assert.equal(validateFile(fakeFile('scan.pdf', '', 1000)).ok, true, 'PDF inferred from extension');
  assert.equal(validateFile(fakeFile('a.exe', 'application/x-msdownload', 1000)).code, 'type');
  assert.equal(validateFile(fakeFile('big.png', 'image/png', 6 * 1024 * 1024)).code, 'size');
  assert.equal(validateFile(fakeFile('zero.png', 'image/png', 0)).code, 'empty');
  assert.equal(isPdfAttachment(fakeFile('x.pdf', '')), true);
  assert.equal(mimeOf(fakeFile('x.jpeg', '')), 'image/jpeg');
});

test('#3/#22: keys are stable for an idempotent retry', () => {
  assert.equal(makeAttachmentKey('doc', 'lib/L1|Aadhaar'), makeAttachmentKey('doc', 'lib/L1|Aadhaar'));
  assert.notEqual(makeAttachmentKey('doc'), makeAttachmentKey('doc'));
});

test('#18: bounded exponential backoff with jitter and Retry-After', () => {
  assert.equal(nextBackoffDelay(0, { random: () => 0 }), 700);
  assert.equal(nextBackoffDelay(1, { random: () => 0 }), 1400);
  assert.equal(nextBackoffDelay(4, { random: () => 0 }), 8000, 'capped');
  assert.ok(nextBackoffDelay(0, { random: () => 1 }) > 700, 'jitter adds delay');
  assert.equal(nextBackoffDelay(0, { retryAfterMs: 1234, random: () => 1 }), 1234);
  assert.equal(nextBackoffDelay(0, { retryAfterMs: 999999, maxMs: 8000 }), 8000);
});

test('#3/#18/#22: retryable errors vs validation errors', () => {
  for (const e of [{ status: 429 }, { status: 503 }, { status: 0 }, { code: 'timeout' }, { name: 'AbortError' }]) assert.equal(isRetryableRequestError(e), true);
  for (const e of [{ status: 400 }, { status: 403 }, { status: 422 }]) assert.equal(isRetryableRequestError(e), false);
  assert.match(friendlyRequestError({ status: 500 }), /starting up/);
  assert.match(friendlyRequestError({ code: 'timeout' }), /took too long/);
  assert.doesNotMatch(friendlyRequestError({ status: 429, message: '<html><style>body{color:red}</style></html>' }), /html|style/i);
});

test('#3/#22: upload retries reuse the same key and report progress', async () => {
  const calls = [];
  let fail = 2;
  const progress = [];
  const r = await uploadData({
    key: 'doc_stable', data: 'data:image/png;base64,AAAA',
    save: async (key) => { calls.push(key); if (fail-- > 0) throw Object.assign(new Error('busy'), { status: 503 }); return { ok: true }; },
    sleep: async () => {}, random: () => 0,
    onProgress: (p, phase) => progress.push([p, phase]),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['doc_stable', 'doc_stable', 'doc_stable']);
  assert.equal(progress.at(-1)[0], 100);
  assert.ok(progress.some(([, phase]) => phase === 'retrying'));
});

test('#3/#22: non-retryable upload errors stop immediately with a friendly message', async () => {
  let calls = 0;
  await assert.rejects(() => uploadData({
    key: 'k', data: 'data:x', save: async () => { calls++; throw Object.assign(new Error('bad file'), { status: 400 }); }, sleep: async () => {},
  }), /bad file/);
  assert.equal(calls, 1);
});

test('#3/#22: timeout wrapper and file preparation do not hang', async () => {
  await assert.rejects(() => withTimeout(new Promise(() => {}), 10), /took too long/);
  const prep = await prepareAttachment({
    file: fakeFile('p.png', 'image/png', 4), key: 'notice_1',
    FileReaderImpl: class {
      readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload(); }
    },
  });
  assert.equal(prep.dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(prep.key, 'notice_1');
});
