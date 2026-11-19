import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library, Settings } from '../src/models.js';

before(async () => { await setup('settings-name-sync'); });
after(async () => { await teardown(); });

test('creating a library also creates settings with the same name', async () => {
  const settings = await Settings.findOne({ tenantId: 'lib-a' }).lean();
  const library = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.ok(settings, 'settings document is missing');
  assert.equal(settings.name, 'Library A');
  assert.equal(library.name, 'Library A');
  const res = await call('GET', '/api/settings', { token: ctx.tokens.a });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Library A');
});

test('PUT /settings updates Library.name when the name changes', async () => {
  const put = await call('PUT', '/api/settings', { token: ctx.tokens.a, body: { name: 'Renamed Library A', logo: '📖' } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.name, 'Renamed Library A');
  const library = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(library.name, 'Renamed Library A');
  // restore for later tests in this file
  await call('PUT', '/api/settings', { token: ctx.tokens.a, body: { name: 'Library A', logo: '📖' } });
});

test('profile library name update also updates settings.name when a settings doc exists', async () => {
  const before = await Settings.findOne({ tenantId: 'lib-b' }).lean();
  assert.ok(before);
  const patch = await call('PATCH', '/api/account/profile', {
    token: ctx.tokens.b,
    body: { library: { name: 'Profile Library B' } },
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const settings = await Settings.findOne({ tenantId: 'lib-b' }).lean();
  const library = await Library.findOne({ libraryId: 'lib-b' }).lean();
  assert.equal(library.name, 'Profile Library B');
  assert.equal(settings.name, 'Profile Library B');
  await call('PATCH', '/api/account/profile', { token: ctx.tokens.b, body: { library: { name: 'Library B' } } });
});

test('profile library name update does not create a settings doc if none exists', async () => {
  await Settings.deleteOne({ tenantId: 'lib-b' });
  const missing = await Settings.findOne({ tenantId: 'lib-b' }).lean();
  assert.equal(missing, null);
  const patch = await call('PATCH', '/api/account/profile', {
    token: ctx.tokens.b,
    body: { library: { name: 'No Settings Library' } },
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const library = await Library.findOne({ libraryId: 'lib-b' }).lean();
  assert.equal(library.name, 'No Settings Library');
  const settings = await Settings.findOne({ tenantId: 'lib-b' }).lean();
  assert.equal(settings, null);
});
