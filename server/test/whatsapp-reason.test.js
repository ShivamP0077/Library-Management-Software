import test from 'node:test';
import assert from 'node:assert/strict';
import { upstreamReason } from '../src/evolution.js';
import { isTransientError } from '../src/whatsapp.js';

test('429 from a waking Evolution is transient', () => {
  assert.equal(isTransientError({ status: 502, upstreamStatus: 429, message: 'x' }), true);
  assert.equal(isTransientError({ status: 502, upstreamStatus: 400, message: 'WhatsApp service request failed (HTTP 400: Connection Closed)' }), true);
  assert.equal(isTransientError({ status: 502, upstreamStatus: 400, message: 'bad' }), false);
});

test('upstreamReason shows the real Evolution reason', () => {
  assert.equal(upstreamReason(400, { response: { message: [{ exists: false, number: '919999999999' }] } }), 'HTTP 400: number 919999999999 is not on WhatsApp');
  assert.equal(upstreamReason(429, { raw: '' }), 'HTTP 429: service is busy or still starting up');
  assert.equal(upstreamReason(500, { response: { message: ['Connection Closed'] } }), 'HTTP 500: Connection Closed');
});
