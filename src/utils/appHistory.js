// Issue #1: browser Back/Forward step through library screens; Back closes an open modal first.
// No router: each screen change pushes a history entry like "#/students".
// State shape: { libos: 1, idx, tab, modal?, dup? }
const w = typeof window !== 'undefined' ? window : null;
let cur = { idx: 0, tab: null };
let modalStack = [];
let tabListener = null;
let nextId = 1;

const url = (tab) => `${w.location.pathname}${w.location.search}#/${tab}`;

export const TAB_FROM_HASH = () => {
  const m = w && /^#\/([a-z-]+)$/.exec(w.location.hash || '');
  return m ? m[1] : null;
};

export function initHistory(tab, onTab) {
  if (!w) return () => {};
  tabListener = onTab;
  modalStack = [];
  // A guard entry under the first screen catches Back there (even when the page
  // before it is another site), so the library is never left by accident.
  if (w.history.state?.libos && w.history.state.idx > 0) {
    cur = { idx: w.history.state.idx, tab };       // reload: keep the existing entries
    w.history.replaceState({ ...w.history.state, tab, modal: undefined }, '', url(tab));
  } else {
    w.history.replaceState({ libos: 1, idx: 0, tab, guard: true }, '', url(tab));
    cur = { idx: 1, tab };
    w.history.pushState({ libos: 1, idx: 1, tab }, '', url(tab));
  }
  w.addEventListener('popstate', onPop);
  return () => { w.removeEventListener('popstate', onPop); tabListener = null; };
}

export function navTab(tab) {
  if (!w || !tabListener || tab === cur.tab) return;
  cur = { idx: cur.idx + 1, tab };
  w.history.pushState({ libos: 1, idx: cur.idx, tab }, '', url(tab));
}

export function pushModal(onClose) {
  if (!w || !tabListener) return () => {};
  const id = nextId++;
  cur = { ...cur, idx: cur.idx + 1 };
  w.history.pushState({ libos: 1, idx: cur.idx, tab: cur.tab, modal: id }, '', url(cur.tab));
  modalStack.push({ id, onClose });
  // Closed from the UI: drop it from the stack and mark its entry as a duplicate to skip later.
  return () => {
    const i = modalStack.findIndex(m => m.id === id);
    if (i === -1) return;
    modalStack.splice(i, 1);
    const s = w.history.state;
    if (s?.libos && s.modal === id) { w.history.replaceState({ ...s, modal: undefined, dup: true }, '', url(s.tab)); cur = { ...cur, dup: true }; }
  };
}

function onPop(e) {
  const s = e.state;
  if (!s?.libos || s.guard) {
    // Back from the first screen would leave the library (old login/landing entry).
    // Stay in the app: signing out is a separate, deliberate action.
    if (tabListener) { w.history.forward(); w.dispatchEvent(new CustomEvent('libos:back-at-start')); }
    return;
  }
  const back = s.idx < cur.idx;
  const from = cur;
  cur = { idx: s.idx, tab: s.tab, dup: !!s.dup };
  if (back && modalStack.length) {
    const top = modalStack.pop();
    try { top.onClose(); } catch { /* ignore */ }
    if (tabListener) tabListener(s.tab);
    return;
  }
  if (tabListener) tabListener(s.tab);
  // Leaving a closed-modal entry backwards onto the same screen: keep going to the previous screen.
  if (back && from.dup && !s.dup && !s.modal && s.tab === from.tab) { w.history.back(); return; }
  // Entries left behind by closed modals are skipped in the same direction.
  if (s.dup || s.modal) { if (back) w.history.back(); else w.history.forward(); }
}

export const _test = { get cur() { return cur; }, get modals() { return modalStack.length; } };
