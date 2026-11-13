import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('owners reach profile from the top menu and Contact Us holds support', () => {
  const header = read('../src/components/Header.jsx');
  const app = read('../src/App.jsx');
  const profile = read('../src/components/profile/LibraryOsProfile.jsx');
  const support = read('../src/components/SupportCenter.jsx');
  const css = read('../src/responsive.css');

  assert.doesNotMatch(header, /id:\s*'support'/);
  assert.doesNotMatch(header, /Help & Support/);
  assert.match(header, /id="nav-tab-profile"/);
  assert.match(header, /id="drawer-profile-card"/);
  assert.match(header, /My Library OS Profile/);
  assert.match(header, /className="header-profile-tab"/);

  assert.match(app, /'support'/);
  assert.match(app, /setProfileScreen\('contact'\)/);
  assert.match(app, /setActiveTab\('profile'\)/);
  assert.doesNotMatch(app, /activeTab === 'support' && <SupportCenter/);

  assert.match(profile, /<SupportCenter embedded \/>/);
  assert.match(profile, /title="Contact Us"/);
  assert.doesNotMatch(profile, /title="Help & Support"/);
  assert.match(profile, /screen === 'support' \? 'contact'/);
  assert.match(support, /embedded = false/);
  assert.match(support, /New ticket/);
  assert.match(support, /!embedded &&/);

  assert.match(css, /padding-bottom:\s*calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.mobile-drawer-profile/);
  assert.match(css, /\.header-profile-tab \{ display: none/);
});
