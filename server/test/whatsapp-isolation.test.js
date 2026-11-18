import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitBreaker, createEvolutionClient } from '../src/evolution.js';
import { isTransientError } from '../src/whatsapp.js';
import { registerWhatsappJobs, startEvolutionKeepAlive, whatsappJobsBelongInWorker } from '../src/whatsappJobs.js';

function jsonRes(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) };
}

test('Evolution timeout rejects quickly and does not hang', async () => {
  const client = createEvolutionClient({
    baseUrl: 'http://evolution.test',
    apiKey: 'test-key',
    timeoutMs: 40,
    breaker: createCircuitBreaker({ failureThreshold: 5, openMs: 60000 }),
    fetchImpl: (_url, opts) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(jsonRes(200, { ok: true })), 5000);
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
      });
    }),
  });
  const started = Date.now();
  await assert.rejects(client.connectionState('libos-a'), /timed out/);
  assert.ok(Date.now() - started < 2000);
});

test('circuit opens after timeouts and 5xx, then fails fast', async () => {
  let hits = 0;
  const client = createEvolutionClient({
    baseUrl: 'http://evolution.test',
    apiKey: 'test-key',
    timeoutMs: 1000,
    breaker: createCircuitBreaker({ failureThreshold: 3, openMs: 60000 }),
    fetchImpl: async () => { hits++; return jsonRes(503, { message: 'down' }); },
  });
  for (let i = 0; i < 3; i++) await assert.rejects(client.sendText('libos-a', '919800000000', 'hi'), /starting up|unavailable|failed/i);
  assert.equal(client.circuitSnapshot().state, 'open');
  await assert.rejects(client.sendText('libos-a', '919800000000', 'hi'), (e) => e.code === 'circuit_open' && e.status === 503);
  assert.equal(hits, 3);
  assert.equal(isTransientError(Object.assign(new Error('x'), { code: 'circuit_open', status: 503 })), false);
});

test('a thrown Evolution error is caught by the client', async () => {
  const client = createEvolutionClient({
    baseUrl: 'http://evolution.test',
    apiKey: 'test-key',
    breaker: createCircuitBreaker({ failureThreshold: 5 }),
    fetchImpl: async () => { throw new Error('socket hang up'); },
  });
  const err = await client.findInstance('libos-a').then(() => null, (e) => e);
  assert.equal(err.status, 503);
  assert.match(err.message, /unreachable/);
});

test('probe closes the circuit; a 404 does not open it', async () => {
  let now = 1000;
  const breaker = createCircuitBreaker({ failureThreshold: 2, openMs: 100, now: () => now });
  let status = 500;
  const client = createEvolutionClient({
    baseUrl: 'http://evolution.test',
    apiKey: 'test-key',
    breaker,
    fetchImpl: async () => jsonRes(status, {}),
  });
  await assert.rejects(client.connectionState('libos-a'));
  await assert.rejects(client.connectionState('libos-a'));
  assert.equal(client.circuitSnapshot().state, 'open');
  await assert.rejects(client.connectionState('libos-a'), (e) => e.code === 'circuit_open');
  now = 1200;
  status = 200;
  const ok = await client.connectionState('libos-a');
  assert.deepEqual(ok, {});
  assert.equal(client.circuitSnapshot().state, 'closed');

  const fresh = createEvolutionClient({
    baseUrl: 'http://evolution.test',
    apiKey: 'test-key',
    breaker: createCircuitBreaker({ failureThreshold: 1, openMs: 60000 }),
    fetchImpl: async () => jsonRes(404, { message: 'missing' }),
  });
  await assert.rejects(fresh.connectionState('missing'), (e) => e.status === 404);
  assert.equal(fresh.circuitSnapshot().state, 'closed');
});

test('WhatsApp jobs stay out of the API when the worker flag is set', () => {
  assert.equal(whatsappJobsBelongInWorker({ WHATSAPP_JOBS_IN_WORKER: 'true' }), true);
  assert.equal(whatsappJobsBelongInWorker({}), false);
  const names = [];
  registerWhatsappJobs((name, _fn, opts) => names.push([name, opts?.intervalMs || null]));
  assert.deepEqual(names.map(n => n[0]), ['whatsapp-reminders', 'whatsapp-receipt-retry']);
});

test('keep-alive does not stack overlapping pings', async () => {
  let hits = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const scheduled = [];
  const started = startEvolutionKeepAlive({
    env: { EVOLUTION_API_URL: 'http://evolution.test', NODE_ENV: 'production' },
    timeoutMs: 5000,
    fetchImpl: () => { hits++; return pending; },
    setTimeoutFn: (fn) => { scheduled.push(fn); return 1; },
    setIntervalFn: () => 2,
  });
  assert.equal(started, true);
  scheduled[0]();
  scheduled[0]();
  await Promise.resolve();
  assert.equal(hits, 1);
  finish(jsonRes(200));
  await pending;
});
