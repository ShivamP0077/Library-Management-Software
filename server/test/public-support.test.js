import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, SA } from './helpers.js';
import { outbox } from '../src/mailer.js';
import { resetRateLimits } from '../src/accounts.js';
import { SupportLookupOtp, SupportTicket } from '../src/support.js';

test.before(async () => { await setup('public-support'); });
test.after(async () => { await teardown(); });
test.beforeEach(() => { resetRateLimits(); outbox.length = 0; });

const tinyPdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.1\n').toString('base64');

const create = (body) => call('POST', '/api/public/support/tickets', { body });

test('public create lands on the admin desk and lookup needs a matching OTP', async () => {
  const made = await create({
    name: 'Ada Visitor', email: 'ada@example.com', category: 'billing',
    description: 'Payment page failed after redirect.', attachments: [{ name: 'note.pdf', data: tinyPdf }],
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.match(made.body.numberLabel, /^#\d{6}$/);
  const desk = await call('GET', '/api/admin/support/tickets?search=' + encodeURIComponent(made.body.numberLabel), { token: ctx.tokens.sa });
  assert.equal(desk.status, 200);
  assert.ok(desk.body.some(t => t.number === made.body.number && t.tenantId === 'public'));

  const bare = await call('GET', `/api/public/support/tickets/${made.body.numberLabel}`);
  assert.equal(bare.status, 401);
  assert.equal(bare.body.ticket, undefined);
  assert.equal(bare.body.messages, undefined);

  const noCode = await call('POST', '/api/public/support/lookup', { body: { ticket: made.body.numberLabel, email: 'ada@example.com' } });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.body.ticket, undefined);

  const otp = await call('POST', '/api/public/support/otp', { body: { ticket: made.body.numberLabel, email: 'ada@example.com' } });
  assert.equal(otp.status, 200);
  const code = (outbox.at(-1)?.text || '').match(/\b(\d{6})\b/)?.[1];
  assert.ok(code);

  for (let i = 0; i < 5; i++) {
    const wrong = await call('POST', '/api/public/support/lookup', { body: { ticket: made.body.numberLabel, email: 'ada@example.com', otp: '000000' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.ticket, undefined);
  }
  const locked = await call('POST', '/api/public/support/lookup', { body: { ticket: made.body.numberLabel, email: 'ada@example.com', otp: code } });
  assert.equal(locked.status, 401);

  outbox.length = 0;
  resetRateLimits();
  const again = await call('POST', '/api/public/support/otp', { body: { ticket: made.body.numberLabel, email: 'ada@example.com' } });
  assert.equal(again.status, 200);
  const good = (outbox.at(-1)?.text || '').match(/\b(\d{6})\b/)?.[1];
  const seen = await call('POST', '/api/public/support/lookup', { body: { ticket: made.body.numberLabel, email: 'ada@example.com', otp: good } });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.ticket.numberLabel, made.body.numberLabel);
  assert.equal(seen.body.ticket.status, 'open');
  assert.match(seen.body.ticket.messages[0].body, /Payment page failed/);
  assert.equal(seen.body.ticket.tenantId, undefined);
  assert.equal(seen.body.ticket.messages[0].attachments[0].data, undefined);

  const other = await call('POST', '/api/public/support/lookup', { body: { ticket: made.body.numberLabel, email: 'other@example.com', otp: good } });
  assert.equal(other.status, 401);

  const stranger = await create({ name: 'Bea', mobile: '9876543210', category: 'general', description: 'Need a seat map export please.' });
  assert.equal(stranger.status, 201);
  const cross = await call('POST', '/api/public/support/lookup', { body: { ticket: stranger.body.numberLabel, email: 'ada@example.com', otp: good } });
  assert.equal(cross.status, 401);
  assert.equal(cross.body.ticket, undefined);

  const row = await SupportLookupOtp.findOne({ usedAt: { $ne: null } }).sort({ createdAt: -1 });
  row.expiresAt = new Date(Date.now() - 1000);
  row.usedAt = null;
  row.lockedAt = null;
  row.attempts = 0;
  await row.save();
  const stale = await call('POST', '/api/public/support/lookup', { body: { ticket: made.body.numberLabel, email: 'ada@example.com', otp: good } });
  assert.equal(stale.status, 401);

  const missing = await call('POST', '/api/public/support/otp', { body: { ticket: '#999999', email: 'ada@example.com' } });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.ok, true);

  const libTicket = await call('POST', '/api/support/tickets', {
    token: ctx.tokens.a,
    body: { subject: 'Library only', category: 'general', message: 'Staff note that must stay private.' },
  });
  assert.equal(libTicket.status, 201);
  const leak = await call('POST', '/api/public/support/lookup', {
    body: { ticket: String(libTicket.body.number).padStart(6, '0'), email: 'admin-a@test.local', otp: '123456' },
  });
  assert.equal(leak.status, 401);
  const stored = await SupportTicket.findOne({ number: libTicket.body.number, tenantId: 'lib-a' });
  assert.ok(stored);
  assert.equal(SA.email.length > 0, true);
});

test('public create is rate limited', async () => {
  resetRateLimits();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await create({ name: 'Rate', email: `r${i}@example.com`, category: 'technical', description: 'Rate limit check message.' });
  }
  assert.equal(last.status, 429);
});
