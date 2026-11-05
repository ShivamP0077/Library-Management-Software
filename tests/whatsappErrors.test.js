import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyWhatsappError, isWakingError } from '../src/utils/whatsappErrors.js';
import { parseJsonSafe } from '../src/utils/parseJsonSafe.js';

test('#18: raw HTML/CSS never reaches the user', () => {
  const m = friendlyWhatsappError({ status: 429, message: '<html><style>body{color:red;}</style>Too Many Requests</html>' });
  assert.equal(m, 'WhatsApp service is starting up. Please try again in a minute.');
  assert.doesNotMatch(friendlyWhatsappError({ status: 502, message: 'body { margin: 0; padding: 0 }' }), /margin/);
});
test('#18: JSON parse errors become friendly', () => {
  assert.match(friendlyWhatsappError({ status: 503, message: "Unexpected token '<'" }), /starting up/);
  assert.equal(friendlyWhatsappError({ status: 400, message: '' }, 'X'), 'X');
});
test('#18: normal server messages are kept', () => {
  assert.equal(friendlyWhatsappError({ status: 400, message: 'Invalid number' }), 'Invalid number');
});
test('#18: waking statuses', () => {
  for (const s of [429, 502, 503, 504]) assert.equal(isWakingError({ status: s }), true);
  assert.equal(isWakingError({ status: 400 }), false);
});
test('#18: api parseJsonSafe handles an HTML reply', () => {
  assert.deepEqual(parseJsonSafe('{"a":1}', 200), { a: 1 });
  assert.match(parseJsonSafe('<html>429</html>', 429).error, /busy or starting up/);
  assert.match(parseJsonSafe('<html>x</html>', 404).error, /Unexpected reply/);
  assert.equal(parseJsonSafe('', 204), null);
});
