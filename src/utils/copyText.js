// Copy text on phones where clipboard.writeText is missing or throws.
export async function copyText(value, { nav, doc } = {}) {
  const text = String(value ?? '');
  const navigatorObj = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : undefined);
  const documentObj = doc !== undefined ? doc : (typeof document !== 'undefined' ? document : undefined);
  const write = navigatorObj?.clipboard?.writeText;
  if (typeof write === 'function') {
    try {
      await write.call(navigatorObj.clipboard, text);
      return true;
    } catch {
      // Fall through. Some Safari builds have writeText but throw outside a secure context.
    }
  }
  if (!documentObj?.body || typeof documentObj.createElement !== 'function') return false;
  const area = documentObj.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  documentObj.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = documentObj.execCommand('copy') === true;
  } catch {
    ok = false;
  }
  documentObj.body.removeChild(area);
  return ok;
}
