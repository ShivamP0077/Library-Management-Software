import React, { useEffect, useState } from 'react';
import { withAbsoluteUrl } from '../../utils/enquiry';
import QRCode from 'qrcode';
import { Copy, Download, Printer, RefreshCw, Share2 } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../auth/AuthContext';
import { useLibrary } from '../../context/LibraryContext';

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function printPoster({ libraryName, dataUrl, url }) {
  if (!String(dataUrl || '').startsWith('data:image/')) return;
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return;
  const title = escapeHtml(libraryName || 'Library enquiry');
  const safeUrl = escapeHtml(url);
  popup.document.write(`<!doctype html><html><head><title>${title} enquiry</title>
    <style>
      body { font-family: sans-serif; text-align: center; margin: 32px; color: #111; }
      h1 { font-size: 28px; margin: 0 0 8px; }
      p { font-size: 18px; margin: 0 0 16px; }
      img { width: 280px; height: 280px; }
      a { color: #111; font-size: 14px; word-break: break-all; }
    </style></head><body>
    <h1>${title}</h1>
    <p>Scan to enquire</p>
    <img src="${dataUrl}" alt="Enquiry QR code" />
    <p><a href="${safeUrl}">${safeUrl}</a></p>
    </body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function EnquiryQrCard() {
  const { user } = useAuth() || {};
  const library = useLibrary() || {};
  const libraryName = library.settings?.name || 'Library';
  const canRegenerate = user?.role === 'client_admin' || user?.role === 'superadmin';
  const [link, setLink] = useState(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    setBusy(true);
    api.enquiryLink()
      .then((data) => setLink(withAbsoluteUrl(data)))
      .catch((err) => setError(err.status === 403 ? 'Only the library owner can manage the enquiry QR.' : (err.message || 'Could not load the enquiry link.')))
      .finally(() => setBusy(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!link?.url) { setQr(''); return; }
    let cancel = false;
    QRCode.toDataURL(link.url, { width: 280, margin: 1 }).then((url) => { if (!cancel) setQr(url); }).catch(() => { if (!cancel) setError('Could not draw the QR code.'); });
    return () => { cancel = true; };
  }, [link?.url]);

  const copy = async () => {
    if (!link?.url) return;
    await copyText(link.url);
    setNotice('Link copied');
  };

  const share = async () => {
    if (!link?.url) return;
    const payload = { title: `${libraryName} enquiry`, text: 'Scan to enquire', url: link.url };
    if (navigator.share) {
      try { await navigator.share(payload); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    await copy();
  };

  const download = () => {
    if (!qr) return;
    const a = document.createElement('a');
    a.href = qr;
    a.download = 'enquiry-qr.png';
    a.click();
  };

  const regenerate = async () => {
    if (!window.confirm('Regenerate this link? The old QR code will stop working.')) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.regenerateEnquiryLink();
      setLink(withAbsoluteUrl(data));
      setNotice('New link ready. The previous QR no longer works.');
    } catch (err) {
      setError(err.message || 'Could not regenerate the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="premium-card" style={{ padding: 20 }} aria-label="Enquiry QR">
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Enquiry QR</h3>
      <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: 13 }}>Students scan this code to send an enquiry. It keeps working even if the plan is locked.</p>
      {busy && !link && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading link…</p>}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      {link?.url && (
        <>
          {qr && <img src={qr} alt={`QR code for ${libraryName} enquiries`} width={220} height={220} style={{ display: 'block', margin: '0 auto 12px', borderRadius: 12, background: '#fff' }} />}
          <p style={{ fontSize: 13, wordBreak: 'break-all', margin: '0 0 12px' }}>{link.url}</p>
          {notice && <p style={{ fontSize: 13, color: '#15803d', margin: '0 0 10px' }}>{notice}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}><Copy size={14} /> Copy</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={share}><Share2 size={14} /> Share</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={download} disabled={!qr}><Download size={14} /> Download PNG</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => printPoster({ libraryName, dataUrl: qr, url: link.url })} disabled={!qr}><Printer size={14} /> Print</button>
            {canRegenerate && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy}><RefreshCw size={14} /> Regenerate link</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
