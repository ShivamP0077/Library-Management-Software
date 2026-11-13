// Support chat: per-side unread counts, mark-read, tenant isolation, legacy description/reply.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { SupportTicket, nextSupportTicketNumber } from '../src/support.js';
import { AuditLog } from '../src/audit.js';

const A = () => ctx.tokens.a, B = () => ctx.tokens.b, SA = () => ctx.tokens.sa;

before(async () => { await setup('lms_support_chat_test'); });
after(teardown);

test('owner can post and read own ticket messages; the other library cannot', async () => {
  const created = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'Chat thread', message: 'Hello support' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.messages.length, 1);
  assert.equal(created.body.messages[0].fromSupport, false);
  assert.equal(created.body.unreadCount, 0);

  const posted = await call('POST', `/api/support/tickets/${created.body.id}/messages`, { token: A(), body: { message: 'A second note' } });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.messages.length, 2);
  assert.equal(posted.body.messages[1].body, 'A second note');

  const read = await call('GET', `/api/support/tickets/${created.body.id}`, { token: A() });
  assert.equal(read.status, 200);
  assert.equal(read.body.messages.length, 2);
  assert.equal(read.body.internalNotes, undefined);

  const otherGet = await call('GET', `/api/support/tickets/${created.body.id}`, { token: B() });
  assert.equal(otherGet.status, 404);
  const otherPost = await call('POST', `/api/support/tickets/${created.body.id}/messages`, { token: B(), body: { message: 'not mine' } });
  assert.equal(otherPost.status, 404);
  const otherRead = await call('POST', `/api/support/tickets/${created.body.id}/read`, { token: B() });
  assert.equal(otherRead.status, 404);
});

test('Super Admin can read and reply to any ticket', async () => {
  const created = await call('POST', '/api/support/tickets', { token: B(), body: { subject: 'From library B', message: 'Need a hand' } });
  assert.equal(created.status, 201);
  const seen = await call('GET', `/api/admin/support/tickets/${created.body.id}`, { token: SA() });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.messages[0].body, 'Need a hand');
  assert.equal(seen.body.unreadCount, 0);
  const reply = await call('POST', `/api/admin/support/tickets/${created.body.id}/messages`, { token: SA(), body: { message: 'On it', status: 'in_progress' } });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.messages.at(-1).fromSupport, true);
  assert.equal(reply.body.messages.at(-1).body, 'On it');
  assert.equal(reply.body.status, 'in_progress');
  const owner = await call('GET', `/api/support/tickets/${created.body.id}`, { token: B() });
  assert.equal(owner.body.messages.length, 2);
  assert.equal(owner.body.messages[1].fromSupport, true);
});

test('Super Admin poll=1 returns the ticket and marks it read without an audit row', async () => {
  const created = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'Quiet poll', message: 'Checking in' } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const target = created.body.numberLabel;
  const viewCount = () => AuditLog.countDocuments({ action: 'support.ticket_view', target });
  const before = await viewCount();

  const polled = await call('GET', `/api/admin/support/tickets/${id}?poll=1`, { token: SA() });
  assert.equal(polled.status, 200);
  assert.equal(polled.body.messages[0].body, 'Checking in');
  assert.equal(polled.body.unreadCount, 0);
  assert.equal(await viewCount(), before, 'poll=1 does not write support.ticket_view');
  const listed = (await call('GET', '/api/admin/support/tickets', { token: SA() })).body.find(t => t.id === id);
  assert.equal(listed.unreadCount, 0, 'poll still marks the ticket read');

  const viewed = await call('GET', `/api/admin/support/tickets/${id}`, { token: SA() });
  assert.equal(viewed.status, 200);
  assert.equal(await viewCount(), before + 1, 'a normal view writes support.ticket_view');
});

test('unreadCount follows the caller side and mark-read clears it', async () => {
  const created = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'Unread badge', message: 'First' } });
  const id = created.body.id;
  const ownerList = (await call('GET', '/api/support/tickets', { token: A() })).body;
  assert.equal(ownerList.find(t => t.id === id).unreadCount, 0, 'own opening message is not unread');
  const adminList = (await call('GET', '/api/admin/support/tickets', { token: SA() })).body;
  assert.equal(adminList.find(t => t.id === id).unreadCount, 1);

  const marked = await call('POST', `/api/admin/support/tickets/${id}/read`, { token: SA() });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.unreadCount, 0);
  assert.ok(marked.body.adminLastReadAt);
  const adminAfter = (await call('GET', '/api/admin/support/tickets', { token: SA() })).body;
  assert.equal(adminAfter.find(t => t.id === id).unreadCount, 0);

  const reply = await call('POST', `/api/admin/support/tickets/${id}/messages`, { token: SA(), body: { message: 'Please try again' } });
  assert.equal(reply.status, 200);
  const ownerUnread = (await call('GET', '/api/support/tickets', { token: A() })).body.find(t => t.id === id);
  assert.equal(ownerUnread.unreadCount, 1);
  // Admin's own reply does not become unread for admin.
  const adminStill = (await call('GET', '/api/admin/support/tickets', { token: SA() })).body.find(t => t.id === id);
  assert.equal(adminStill.unreadCount, 0);

  const ownerMark = await call('POST', `/api/support/tickets/${id}/read`, { token: A() });
  assert.equal(ownerMark.status, 200);
  assert.equal(ownerMark.body.unreadCount, 0);
  const ownerCleared = (await call('GET', '/api/support/tickets', { token: A() })).body.find(t => t.id === id);
  assert.equal(ownerCleared.unreadCount, 0);

  // Opening the ticket (GET) is also a mark-read for that side.
  await call('POST', `/api/admin/support/tickets/${id}/messages`, { token: SA(), body: { message: 'One more' } });
  assert.equal((await call('GET', '/api/support/tickets', { token: A() })).body.find(t => t.id === id).unreadCount, 1);
  await call('GET', `/api/support/tickets/${id}`, { token: A() });
  assert.equal((await call('GET', '/api/support/tickets', { token: A() })).body.find(t => t.id === id).unreadCount, 0);
});

test('legacy description and reply are shown as messages without rewriting the ticket', async () => {
  const number = await nextSupportTicketNumber();
  const doc = await SupportTicket.create({
    tenantId: 'lib-a',
    number,
    subject: 'Legacy shape',
    description: 'Old description text',
    reply: 'Old reply text',
    messages: [],
    createdByEmail: 'admin-a@test.local',
    status: 'open',
    statusHistory: [],
  });
  const id = String(doc._id);
  const listed = (await call('GET', '/api/support/tickets', { token: A() })).body.find(t => t.id === id);
  assert.equal(listed.messageCount, 2);
  assert.equal(listed.unreadCount, 1, 'legacy reply is unread until the owner opens it');
  assert.equal(listed.internalNotes, undefined);
  const adminListed = (await call('GET', '/api/admin/support/tickets', { token: SA() })).body.find(t => t.id === id);
  assert.equal(adminListed.unreadCount, 1, 'legacy description is unread for support');

  const ownerView = await call('GET', `/api/support/tickets/${id}`, { token: A() });
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.body.messages.length, 2);
  assert.equal(ownerView.body.messages[0].id, 'legacy-description');
  assert.equal(ownerView.body.messages[0].body, 'Old description text');
  assert.equal(ownerView.body.messages[0].fromSupport, false);
  assert.equal(ownerView.body.messages[1].id, 'legacy-reply');
  assert.equal(ownerView.body.messages[1].body, 'Old reply text');
  assert.equal(ownerView.body.messages[1].fromSupport, true);
  assert.equal(ownerView.body.description, undefined);
  assert.equal(ownerView.body.reply, undefined);
  assert.equal(ownerView.body.internalNotes, undefined);
  assert.equal(ownerView.body.number, number);

  const raw = await SupportTicket.findOne({ _id: doc._id, tenantId: 'lib-a' }).lean();
  assert.equal(raw.messages.length, 0, 'legacy fields are not copied into messages');
  assert.equal(raw.description, 'Old description text');
  assert.equal(raw.reply, 'Old reply text');
  assert.equal(raw.number, number);

  const note = await call('POST', `/api/admin/support/tickets/${id}/internal-notes`, { token: SA(), body: { body: 'LEGACY-NOTE-SECRET' } });
  assert.equal(note.status, 201);
  const ownerAgain = await call('GET', `/api/support/tickets/${id}`, { token: A() });
  assert.equal(ownerAgain.body.internalNotes, undefined);
  assert.doesNotMatch(JSON.stringify(ownerAgain.body), /LEGACY-NOTE-SECRET/);
  const adminView = await call('GET', `/api/admin/support/tickets/${id}`, { token: SA() });
  assert.equal(adminView.body.internalNotes[0].body, 'LEGACY-NOTE-SECRET');
  assert.equal(adminView.body.messages.length, 2);
});
