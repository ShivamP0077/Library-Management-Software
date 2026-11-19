// Public enquiry form: validation, honeypot, rate limit, dedupe, tenant isolation, lock.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library, models, Settings } from '../src/models.js';
import { Enquiry } from '../src/enquiry.js';
import { SoftwarePlan } from '../src/plans.js';
import { resetRateLimits } from '../src/accounts.js';

before(async () => {
  await setup('enquiry');
  process.env.FRONTEND_URL = 'https://app.example.test';
  for (const [token, id, name] of [[ctx.tokens.a, 's1', 'Morning'], [ctx.tokens.b, 's2', 'Evening']]) {
    assert.equal((await call('POST', '/api/shifts', { token, body: { id, name } })).status, 201);
    assert.equal((await call('POST', '/api/plans', { token, body: { id: `p-${id}`, name: `${name} Plan`, price: 999 } })).status, 201);
  }
  await call('PUT', '/api/settings', { token: ctx.tokens.a, body: { logo: 'LOGO-A' } });
});
after(async () => { delete process.env.FRONTEND_URL; await teardown(); });
beforeEach(() => resetRateLimits());

const linkOf = async (token) => (await call('GET', '/api/enquiries/link', { token })).body;

test('public form returns names only and accepts a valid enquiry', async () => {
  const link = await linkOf(ctx.tokens.a);
  assert.match(link.token, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(link.url, `https://app.example.test/enquiry/${link.token}`);
  const pub = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.libraryName, 'Library A');
  assert.equal(pub.body.logo, 'LOGO-A');
  assert.equal(pub.body.shifts, undefined);
  assert.deepEqual(pub.body.plans, [{ id: 'p-s1', name: 'Morning Plan', price: 999 }]);
  assert.equal(pub.body.plans[0].planId, undefined);
  assert.equal(pub.body.plans[0].priceMonthly, undefined);

  const bad = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '12345', gender: 'female' } });
  assert.equal(bad.status, 400);
  const longMsg = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '9876543210', gender: 'male', message: 'x'.repeat(501) } });
  assert.equal(longMsg.status, 400);
  const badEmail = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '9876543210', gender: 'male', email: 'nope' } });
  assert.equal(badEmail.status, 400);

  const ok = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Riya', mobile: '+91 98765 43210', email: 'riya@example.com', gender: 'female', preferred: 'Morning', preferredPlan: 'p-s1', seatPlan: 'Morning Plan', message: 'Need a seat' },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const list = await call('GET', '/api/enquiries', { token: ctx.tokens.a });
  assert.equal(list.body.waitingCount, 1);
  assert.equal(list.body.items[0].name, 'Riya');
  assert.equal(list.body.items[0].mobile, '919876543210');
  assert.equal(list.body.items[0].gender, 'female');
  assert.equal(list.body.items[0].preferred, '');
  assert.equal(list.body.items[0].status, 'waiting');
  assert.equal(list.body.items[0].source, 'qr');
  const count = await call('GET', '/api/enquiries/count', { token: ctx.tokens.a });
  assert.equal(count.body.waiting, 1);
});

test('honeypot is discarded and the same mobile within 24h updates', async () => {
  const link = await linkOf(ctx.tokens.a);
  const before = await Enquiry.countDocuments({ tenantId: 'lib-a' });
  const honey = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Bot', mobile: '9876543211', website: 'http://spam.test', message: 'buy now' },
  });
  assert.equal(honey.status, 200);
  assert.equal(await Enquiry.countDocuments({ tenantId: 'lib-a' }), before);

  const first = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'Aman', mobile: '9123456780', gender: 'male', message: 'Hi', preferred: 'Keep me' } });
  assert.equal(first.status, 201);
  await Enquiry.updateOne({ tenantId: 'lib-a', mobile: '919123456780' }, { $set: { preferred: 'Old plan' } });
  const second = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'Aman Kumar', mobile: '09123456780', gender: 'male', message: 'Updated', preferred: 'New plan' } });
  assert.equal(second.status, 200);
  const rows = await Enquiry.find({ tenantId: 'lib-a', mobile: '919123456780' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Aman Kumar');
  assert.equal(rows[0].message, 'Updated');
  assert.equal(rows[0].preferred, 'Old plan');
});

test('rate limit is per IP and token', async () => {
  const link = await linkOf(ctx.tokens.b);
  for (let i = 0; i < 5; i += 1) {
    const r = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: `N${i}`, mobile: `900000000${i}`, gender: 'other' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const blocked = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'Too many', mobile: '9000000009', gender: 'other' } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'rate_limited');
});

test('tenants cannot see each other; regenerate kills the old token', async () => {
  const a = await linkOf(ctx.tokens.a);
  const b = await linkOf(ctx.tokens.b);
  await call('POST', `/api/public/enquiry/${b.token}`, { body: { name: 'Only B', mobile: '9988776655', gender: 'male' } });
  const listA = (await call('GET', '/api/enquiries', { token: ctx.tokens.a })).body.items.map(i => i.name);
  assert.equal(listA.includes('Only B'), false);
  const pubB = await call('GET', `/api/public/enquiry/${b.token}`);
  assert.equal(pubB.body.libraryName, 'Library B');
  assert.deepEqual(pubB.body.plans.map(p => p.name), ['Evening Plan']);

  const next = await call('POST', '/api/enquiries/link/regenerate', { token: ctx.tokens.b });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.token, b.token);
  assert.equal((await call('GET', `/api/public/enquiry/${b.token}`)).status, 404);
  assert.equal((await call('GET', `/api/public/enquiry/${next.body.token}`)).status, 200);

  const item = (await call('GET', '/api/enquiries', { token: ctx.tokens.b })).body.items.find(i => i.name === 'Only B');
  const patched = await call('PATCH', `/api/enquiries/${item.id}`, { token: ctx.tokens.b, body: { status: 'admitted' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, 'admitted');
  const other = await call('PATCH', `/api/enquiries/${item.id}`, { token: ctx.tokens.a, body: { status: 'removed' } });
  assert.equal(other.status, 404);
});

test('a locked library still accepts the public form; the owner list stays locked', async () => {
  const link = await linkOf(ctx.tokens.a);
  assert.ok(link.token);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { subscription: { planId: 'x', status: 'expired', price: 1, interval: 'month', currentPeriodEnd: new Date(Date.now() - 864e5) } } });
  assert.equal((await call('GET', '/api/enquiries/link', { token: ctx.tokens.a })).status, 402);
  const token = link.token;
  const sent = await call('POST', `/api/public/enquiry/${token}`, { body: { name: 'After lock', mobile: '9811111111', gender: 'female', message: 'Still here' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal((await call('GET', '/api/enquiries', { token: ctx.tokens.a })).status, 402);
  assert.equal((await call('GET', '/api/enquiries/count', { token: ctx.tokens.a })).status, 402);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { 'subscription.status': 'active', 'subscription.currentPeriodEnd': new Date(Date.now() + 10 * 864e5) } });
  const list = await call('GET', '/api/enquiries', { token: ctx.tokens.a });
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some(i => i.name === 'After lock'));
});

test('catalogue is fee plans only; branch and section are checked; images are limited', async () => {
  await SoftwarePlan.create({ planId: 'saas-gold', name: 'SaaS Gold', priceMonthly: 4999, public: true, active: true });
  const link = await linkOf(ctx.tokens.a);
  const pub = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(pub.body.plans.some(p => p.name === 'SaaS Gold' || p.priceMonthly), false);
  assert.equal(JSON.stringify(pub.body).includes('SaaS Gold'), false);
  resetRateLimits();
  const noGender = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '9876543210' } });
  assert.equal(noGender.status, 400);
  const badGender = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '9876543210', gender: 'prefer-not' } });
  assert.equal(badGender.status, 400);
  resetRateLimits();

  assert.equal((await call('POST', '/api/branches', { token: ctx.tokens.a, body: { id: 'br-1', name: 'Main' } })).status, 201);
  const only = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Solo', mobile: '9765432100', gender: 'female', branchId: 'nope' },
  });
  assert.equal(only.status, 400);
  const auto = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Solo', mobile: '9765432100', gender: 'female' },
  });
  assert.equal(auto.status, 201, JSON.stringify(auto.body));
  const saved = await Enquiry.findOne({ tenantId: 'lib-a', mobile: '919765432100' }).lean();
  assert.equal(saved.branchId, 'br-1');

  assert.equal((await call('POST', '/api/branches', { token: ctx.tokens.a, body: { id: 'br-2', name: 'Annex' } })).status, 201);
  assert.equal((await call('POST', '/api/sections', { token: ctx.tokens.a, body: { id: 'sec-1', name: 'Hall', branchId: 'br-2' } })).status, 201);
  assert.equal((await call('POST', '/api/sections', { token: ctx.tokens.a, body: { id: 'sec-2', name: 'Cabin', branchId: 'br-2' } })).status, 201);
  const missing = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Pick', mobile: '9654321098', gender: 'male' },
  });
  assert.equal(missing.status, 400);
  const wrongSection = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Pick', mobile: '9654321098', gender: 'male', branchId: 'br-1', sectionId: 'sec-1' },
  });
  assert.equal(wrongSection.status, 400);
  const picked = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Pick', mobile: '9654321098', gender: 'male', branchId: 'br-2', sectionId: 'sec-2' },
  });
  assert.equal(picked.status, 201, JSON.stringify(picked.body));

  resetRateLimits();
  const png = `data:image/png;base64,${Buffer.from('not-a-jpeg').toString('base64')}`;
  const badType = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Pic', mobile: '9543210987', gender: 'other', branchId: 'br-1', photo: png },
  });
  assert.equal(badType.status, 400);
  const big = `data:image/jpeg;base64,${Buffer.alloc(501 * 1024, 1).toString('base64')}`;
  const tooBig = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Pic', mobile: '9543210987', gender: 'other', branchId: 'br-1', aadhaar: big },
  });
  assert.equal(tooBig.status, 400);
  const small = `data:image/webp;base64,${Buffer.from('small-webp-bytes').toString('base64')}`;
  const withPhoto = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Pic', mobile: '9543210987', gender: 'other', branchId: 'br-1', photo: small },
  });
  assert.equal(withPhoto.status, 201, JSON.stringify(withPhoto.body));
  const row = await Enquiry.findOne({ tenantId: 'lib-a', mobile: '919543210987' }).lean();
  assert.match(row.photo, /^data:image\/webp;base64,/);
  const listed = (await call('GET', '/api/enquiries', { token: ctx.tokens.a })).body.items.find(i => i.name === 'Pic');
  assert.equal(listed.photo, undefined);

  const before = link.token;
  const poster = await call('PUT', '/api/enquiries/poster', {
    token: ctx.tokens.a,
    body: { heading: 'Welcome', message: 'Scan here', theme: 'forest', facilities: 'AC, Wi-Fi', showLogo: true },
  });
  assert.equal(poster.status, 200);
  assert.equal(poster.body.poster.heading, 'Welcome');
  assert.equal(poster.body.poster.theme, 'forest');
  const again = await linkOf(ctx.tokens.a);
  assert.equal(again.token, before);
  assert.equal(again.poster.heading, 'Welcome');
  assert.equal(models.plans.modelName, 'Plan');
});

test('public GET includes enquiryForm defaults and keeps plans visible', async () => {
  const link = await linkOf(ctx.tokens.a);
  const pub = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.enquiryForm.fields.name.required, true);
  assert.equal(pub.body.enquiryForm.fields.gender.required, true);
  assert.equal(pub.body.enquiryForm.documents.show, true);
  assert.equal(pub.body.enquiryForm.plan.show, true);
  assert.equal(pub.body.plans[0].id, 'p-s1');
});

test('hiding gender lets a POST succeed without it, and hidden documents are stripped', async () => {
  const link = await linkOf(ctx.tokens.a);
  const save = await call('PUT', '/api/settings', {
    token: ctx.tokens.a,
    body: {
      logo: 'LOGO-A',
      enquiryForm: {
        fields: { gender: { show: false, required: true }, email: { show: true, required: false }, branch: { show: false }, section: { show: false } },
        documents: { show: false, required: false },
        plan: { show: true, required: false },
      },
    },
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const pub = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(pub.body.enquiryForm.fields.gender.show, false);
  const ok = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Kiran', mobile: '9876500123', aadhaar: 'data:image/jpeg;base64,aaaa', photo: 'data:image/jpeg;base64,bbbb' },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const list = await call('GET', '/api/enquiries', { token: ctx.tokens.a });
  const row = list.body.items.find((item) => item.mobile === '919876500123' || item.name === 'Kiran');
  assert.ok(row, JSON.stringify(list.body));
  assert.equal(row.gender, '');
  const stored = await Enquiry.findOne({ tenantId: 'lib-a', mobile: '919876500123' }).lean();
  assert.equal(stored.aadhaar, '');
  assert.equal(stored.photo, '');
});

test('plan toggle off hides plans and does not require a plan; plan on accepts a valid preferredPlan', async () => {
  const link = await linkOf(ctx.tokens.a);
  let save = await call('PUT', '/api/settings', {
    token: ctx.tokens.a,
    body: { logo: 'LOGO-A', enquiryForm: { plan: { show: false, required: false }, documents: { show: true, required: false }, fields: { gender: { show: true, required: true }, branch: { show: false }, section: { show: false } } } },
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const hidden = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(hidden.body.enquiryForm.plan.show, false);
  assert.deepEqual(hidden.body.plans, []);
  const without = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Neha', mobile: '9876500456', gender: 'female', preferredPlan: 'p-s1' },
  });
  assert.equal(without.status, 201, JSON.stringify(without.body));
  let stored = await Enquiry.findOne({ tenantId: 'lib-a', mobile: '919876500456' }).lean();
  assert.equal(stored.preferredPlan || '', '');

  save = await call('PUT', '/api/settings', {
    token: ctx.tokens.a,
    body: { logo: 'LOGO-A', enquiryForm: { plan: { show: true, required: false }, fields: { gender: { show: true, required: true }, branch: { show: false }, section: { show: false } } } },
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const shown = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(shown.body.enquiryForm.plan.show, true);
  assert.equal(shown.body.plans[0].id, 'p-s1');
  const withPlan = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Vikram', mobile: '9876500789', gender: 'male', preferredPlan: 'p-s1' },
  });
  assert.equal(withPlan.status, 201, JSON.stringify(withPlan.body));
  stored = await Enquiry.findOne({ tenantId: 'lib-a', mobile: '919876500789' }).lean();
  assert.equal(stored.preferredPlan, 'p-s1');
  const bad = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Bad Plan', mobile: '9876500999', gender: 'other', preferredPlan: 'not-a-plan' },
  });
  assert.equal(bad.status, 400);
});
