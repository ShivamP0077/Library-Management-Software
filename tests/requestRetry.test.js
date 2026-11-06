// Issue #20/#22: bounded client retries with AbortController and readable failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestWithRetry, RequestError } from '../src/utils/request.js';

test('bounded retry succeeds after transient network failures', async () => {
  let calls = 0;
  const res = await requestWithRetry('https://support.invalid/api/test', {
    retries: 2, retryDelayMs: 1,
    fetchImpl: async () => {
      calls++;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(calls, 3);
  assert.equal(res.status, 200);
});

test('failed HTTPS request becomes a readable message after bounded retries', async () => {
  let calls = 0;
  await assert.rejects(
    () => requestWithRetry('https://support.invalid/api/test', {
      retries: 2, retryDelayMs: 1,
      fetchImpl: async () => { calls++; throw new TypeError('fetch failed'); },
    }),
    err => err instanceof RequestError
      && err.timeout === false
      && /Could not reach the server\. Check your connection and retry\./.test(err.message)
  );
  assert.equal(calls, 3, 'retries are capped');
});

test('request timeout aborts instead of spinning forever', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_ok, fail) => {
    signal.addEventListener('abort', () => fail(signal.reason || new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(
    () => requestWithRetry('https://slow.invalid/api/test', { retries: 0, timeoutMs: 1000, fetchImpl }),
    err => err instanceof RequestError && err.timeout === true && /took too long/.test(err.message)
  );
});

test('409 NOTICE_IN_FLIGHT is retried when the caller supplies an idempotency key', async () => {
  let calls = 0;
  const res = await requestWithRetry('https://support.invalid/api/notices', {
    retries: 2, retryDelayMs: 1,
    fetchImpl: async () => {
      calls++;
      if (calls < 2) return new Response(JSON.stringify({ error: 'still saving', code: 'NOTICE_IN_FLIGHT' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: 'notice-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(calls, 2);
  assert.equal(res.status, 201);
});
