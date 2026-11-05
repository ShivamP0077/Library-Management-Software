import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser history fake (async popstate, like real browsers).
function fakeWindow() {
  const entries = [{ state: null, url: '/' }]; let i = 0; const ls = [];
  const fire = () => setTimeout(() => ls.forEach(f => f({ state: entries[i].state })), 0);
  return {
    location: { pathname: '/', search: '', hash: '' },
    history: {
      get state() { return entries[i].state; },
      pushState(s, _, u) { entries.splice(i + 1); entries.push({ state: s, url: u }); i++; },
      replaceState(s, _, u) { entries[i] = { state: s, url: u }; },
      back() { if (i > 0) { i--; fire(); } },
      forward() { if (i < entries.length - 1) { i++; fire(); } },
    },
    addEventListener(t, f) { if (t === 'popstate') ls.push(f); },
    removeEventListener(t, f) { const k = ls.indexOf(f); if (k >= 0) ls.splice(k, 1); },
    get index() { return i; }, entries,
  };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('back/forward walk tabs, back closes modal first, closed modals are skipped', async () => {
  globalThis.window = fakeWindow();
  const h = await import('../src/utils/appHistory.js');
  let tab = 'dashboard';
  h.initHistory(tab, t => { tab = t; });
  h.navTab('students'); tab = 'students';
  h.navTab('payments'); tab = 'payments';
  window.history.back(); await tick();
  assert.equal(tab, 'students');
  window.history.forward(); await tick();
  assert.equal(tab, 'payments');
  // modal opened then closed by Back
  let open = true; h.pushModal(() => { open = false; });
  window.history.back(); await tick();
  assert.equal(open, false); assert.equal(tab, 'payments');
  // modal opened then closed from the UI: the next Back goes to the previous tab, not a dead entry
  const release = h.pushModal(() => {}); release();
  window.history.back(); await tick(); await tick();
  assert.equal(tab, 'students');
  window.history.back(); await tick();
  assert.equal(tab, 'dashboard');
  // Back on the first screen stays in the app (guard entry), it does not leave.
  let warned = 0; window.dispatchEvent = () => { warned++; };
  window.history.back(); await tick(); await tick();
  assert.equal(warned, 1);
  assert.equal(window.history.state.guard, undefined);
  assert.equal(window.history.state.tab, 'dashboard');
});
