/** Enquiry poster copy and A4 layout. Editing these fields never includes the QR URL. */

export const POSTER_THEMES = {
  classic: { name: 'Classic', bg: '#f8f4ec', ink: '#1e293b', accent: '#1d4ed8', band: '#1e3a8a' },
  forest: { name: 'Forest', bg: '#f3f7f2', ink: '#14532d', accent: '#15803d', band: '#166534' },
  sunset: { name: 'Sunset', bg: '#fff7ed', ink: '#7c2d12', accent: '#c2410c', band: '#9a3412' },
  ink: { name: 'Ink', bg: '#f8fafc', ink: '#0f172a', accent: '#0f172a', band: '#0f172a' },
};

export const DEFAULT_POSTER = {
  heading: 'Join our library',
  message: 'Scan the code to send an enquiry. We will contact you.',
  phone: '',
  address: '',
  facilities: '',
  showPhone: false,
  showAddress: false,
  showLogo: true,
  theme: 'classic',
};

const clip = (value, max) => String(value || '').trim().slice(0, max);

export function normalizePoster(input = {}, library = {}) {
  const theme = POSTER_THEMES[input.theme] ? input.theme : 'classic';
  const phone = clip(input.phone ?? library.phone, 40);
  const address = clip(input.address ?? library.address, 180);
  return {
    heading: clip(input.heading, 80) || library.name || DEFAULT_POSTER.heading,
    message: clip(input.message, 280) || DEFAULT_POSTER.message,
    phone,
    address,
    facilities: clip(input.facilities, 180),
    showPhone: Boolean(input.showPhone) && Boolean(phone),
    showAddress: Boolean(input.showAddress) && Boolean(address),
    showLogo: input.showLogo !== false,
    theme,
  };
}

/** A saved poster draft must not carry or rewrite the enquiry link. */
export function posterDraftOmitsUrl(draft) {
  return draft == null || draft.url == null && draft.token == null;
}

export function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function posterFacilities(poster) {
  return String(poster?.facilities || '').split(/[,•\n]/).map(s => s.trim()).filter(Boolean).slice(0, 8);
}

/** Print-ready A4 document. The QR image is embedded; the URL string is not rewritten. */
export function posterDocumentHtml({ poster, libraryName, logoUrl, qrDataUrl }) {
  const theme = POSTER_THEMES[poster?.theme] || POSTER_THEMES.classic;
  const facilities = posterFacilities(poster).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const logo = poster?.showLogo && logoUrl
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" />`
    : (poster?.showLogo && libraryName ? `<div class="mark">${escapeHtml(String(libraryName).slice(0, 1))}</div>` : '');
  const phone = poster?.showPhone && poster.phone ? `<p class="meta">${escapeHtml(poster.phone)}</p>` : '';
  const address = poster?.showAddress && poster.address ? `<p class="meta">${escapeHtml(poster.address)}</p>` : '';
  const qr = String(qrDataUrl || '').startsWith('data:image/')
    ? `<img class="qr" src="${qrDataUrl}" alt="Enquiry QR code" />`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(poster?.heading || libraryName || 'Enquiry poster')}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: ${theme.bg}; color: ${theme.ink}; font-family: Georgia, "Times New Roman", serif; }
  .sheet { width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 18mm 16mm; }
  .band { background: ${theme.band}; color: #fff; padding: 10mm 8mm; border-radius: 6mm; text-align: center; }
  .logo, .mark { width: 22mm; height: 22mm; object-fit: contain; margin: 0 auto 4mm; display: block; }
  .mark { line-height: 22mm; font-size: 14mm; background: rgba(255,255,255,.15); border-radius: 4mm; }
  h1 { font-size: 28pt; line-height: 1.15; margin: 0 0 4mm; }
  .message { font-size: 14pt; line-height: 1.4; margin: 0; }
  .qr { width: 68mm; height: 68mm; background: #fff; padding: 3mm; margin: 10mm auto; display: block; }
  ul { display: flex; flex-wrap: wrap; gap: 3mm; justify-content: center; list-style: none; padding: 0; margin: 4mm 0 0; }
  li { border: 0.4mm solid ${theme.accent}; color: ${theme.accent}; border-radius: 99px; padding: 1.5mm 4mm; font-family: sans-serif; font-size: 11pt; }
  .meta { font-family: sans-serif; font-size: 12pt; text-align: center; margin: 2mm 0; }
  .foot { text-align: center; font-family: sans-serif; font-size: 10pt; margin-top: 8mm; opacity: .7; }
</style></head><body><article class="sheet">
  <header class="band">${logo}<h1>${escapeHtml(poster?.heading || '')}</h1><p class="message">${escapeHtml(poster?.message || '')}</p></header>
  ${qr}
  ${facilities ? `<ul>${facilities}</ul>` : ''}
  ${phone}${address}
  <p class="foot">${escapeHtml(libraryName || '')} · Scan to enquire</p>
</article></body></html>`;
}
