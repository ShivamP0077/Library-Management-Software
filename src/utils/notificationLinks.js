/** Turn a notification deep link {tab, params} into navigation (tab switch + hash for the record). */
export function openNotificationLink(link, setActiveTab) {
  if (!link?.tab) return;
  const params = new URLSearchParams();
  Object.entries(link.params || {}).forEach(([k, v]) => v != null && params.set(k, String(v)));
  setActiveTab(link.tab);
  const hash = params.toString();
  if (hash) setTimeout(() => { window.location.hash = hash; }, 50);
}
