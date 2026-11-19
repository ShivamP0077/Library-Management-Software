import React, { useEffect, useMemo, useState } from 'react';
import { withAbsoluteUrl } from '../../utils/enquiry';
import { DEFAULT_POSTER, POSTER_THEMES, normalizePoster, posterDocumentHtml, posterFacilities } from '../../utils/enquiryPoster';
import { buildPosterPdf } from '../../utils/posterPdf';
import QRCode from 'qrcode';
import { Copy, Download, Pencil, Printer, RefreshCw, Share2 } from 'lucide-react';
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

function libraryLogoUrl(logo) {
  const value = typeof logo === 'string' ? logo.trim() : '';
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(value)) return value;
  if (value.startsWith('/') && /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(value)) return value;
  return '';
}

async function toDataUrl(src) {
  if (!src) return '';
  if (src.startsWith('data:image/')) return src;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PosterPreview({ poster, libraryName, logoUrl, qr }) {
  const theme = POSTER_THEMES[poster.theme] || POSTER_THEMES.classic;
  return (
    <div aria-label="Poster preview" style={{ background: theme.bg, color: theme.ink, borderRadius: 12, padding: 12, border: '1px solid var(--border, #e5e7eb)' }}>
      <div style={{ background: theme.band, color: '#fff', borderRadius: 10, padding: 12, textAlign: 'center' }}>
        {poster.showLogo && logoUrl && <img src={logoUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />}
        <div style={{ fontWeight: 700, fontSize: 16 }}>{poster.heading}</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>{poster.message}</div>
      </div>
      {qr && <img src={qr} alt="" width={120} height={120} style={{ display: 'block', margin: '10px auto', background: '#fff' }} />}
      {posterFacilities(poster).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {posterFacilities(poster).map(item => <span key={item} style={{ fontSize: 11, border: `1px solid ${theme.accent}`, color: theme.accent, borderRadius: 99, padding: '2px 8px' }}>{item}</span>)}
        </div>
      )}
      {poster.showPhone && <div style={{ textAlign: 'center', fontSize: 12 }}>{poster.phone}</div>}
      {poster.showAddress && <div style={{ textAlign: 'center', fontSize: 12 }}>{poster.address}</div>}
      <div style={{ textAlign: 'center', fontSize: 11, opacity: 0.7, marginTop: 6 }}>{libraryName} · Scan to enquire</div>
    </div>
  );
}

export function EnquiryQrCard() {
  const { user, library: authLibrary } = useAuth() || {};
  const library = useLibrary() || {};
  const settings = library.settings || {};
  const libraryName = settings.name || authLibrary?.name || 'Library';
  const logoUrl = libraryLogoUrl(settings.logo);
  const canRegenerate = user?.role === 'client_admin' || user?.role === 'superadmin';
  const [link, setLink] = useState(null);
  const [qr, setQr] = useState('');
  const [poster, setPoster] = useState(DEFAULT_POSTER);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    setBusy(true);
    api.enquiryLink()
      .then((data) => {
        const next = withAbsoluteUrl(data);
        setLink(next);
        setPoster(normalizePoster(data.poster || {}, { name: libraryName, phone: settings.phone, address: settings.address }));
      })
      .catch((err) => setError(err.status === 403 ? 'Only the library owner can manage the enquiry QR.' : (err.message || 'Could not load the enquiry link.')))
      .finally(() => setBusy(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!link?.url) { setQr(''); return; }
    let cancel = false;
    QRCode.toDataURL(link.url, { width: 480, margin: 1 }).then((url) => { if (!cancel) setQr(url); }).catch(() => { if (!cancel) setError('Could not draw the QR code.'); });
    return () => { cancel = true; };
  }, [link?.url]);

  const previewPoster = useMemo(() => normalizePoster(draft || poster, { name: libraryName }), [draft, poster, libraryName]);

  const copy = async () => {
    if (!link?.url) return;
    await copyText(link.url);
    setNotice('Link copied');
  };

  const share = async () => {
    if (!link?.url) return;
    const payload = { title: `${libraryName} enquiry`, text: previewPoster.heading, url: link.url };
    if (navigator.share) {
      try { await navigator.share(payload); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    await copy();
  };

  const fullPosterBlob = async () => {
    const logoDataUrl = poster.showLogo ? await toDataUrl(logoUrl) : '';
    return buildPosterPdf({ poster: previewPoster, libraryName, logoDataUrl, qrDataUrl: qr });
  };

  const download = async () => {
    if (!qr || !link?.url) return;
    downloadBlob(await fullPosterBlob(), 'enquiry-poster.pdf');
    setNotice('Full poster downloaded');
  };

  const print = async () => {
    if (!qr || !link?.url) return;
    const logoDataUrl = poster.showLogo ? await toDataUrl(logoUrl) : '';
    const html = posterDocumentHtml({ poster: previewPoster, libraryName, logoUrl: logoDataUrl || logoUrl, qrDataUrl: qr });
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      downloadBlob(await fullPosterBlob(), 'enquiry-poster.pdf');
      setNotice('The print window was blocked. The full poster was downloaded instead.');
      return;
    }
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
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

  const savePoster = async () => {
    const next = normalizePoster(draft, { name: libraryName, phone: settings.phone, address: settings.address });
    setBusy(true);
    setError('');
    try {
      const saved = await api.saveEnquiryPoster(next);
      setPoster(normalizePoster(saved.poster || next, { name: libraryName }));
      setDraft(null);
      setNotice('Poster saved');
    } catch (err) {
      setError(err.message || 'Could not save the poster.');
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, extra = {}) => (
    <label className="form-group" style={{ display: 'block', marginBottom: 8 }}>
      <span className="form-label">{label}</span>
      {extra.area ? (
        <textarea className="form-textarea" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
      ) : (
        <input className="form-input" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
      )}
    </label>
  );

  return (
    <section className="premium-card" style={{ padding: 20 }} aria-label="Enquiry QR">
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Enquiry QR</h3>
      <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: 13 }}>Students scan this code to send an enquiry. It keeps working even if the plan is locked.</p>
      {busy && !link && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading link…</p>}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      {link?.url && (
        <>
          <PosterPreview poster={previewPoster} libraryName={libraryName} logoUrl={logoUrl} qr={qr} />
          <p style={{ fontSize: 13, wordBreak: 'break-all', margin: '12px 0' }}>{link.url}</p>
          {notice && <p style={{ fontSize: 13, color: '#15803d', margin: '0 0 10px' }}>{notice}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}><Copy size={14} /> Copy</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={share}><Share2 size={14} /> Share</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={download} disabled={!qr}><Download size={14} /> Download full poster</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={print} disabled={!qr}><Printer size={14} /> Print full poster</button>
            {canRegenerate && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy}><RefreshCw size={14} /> Regenerate Link</button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(draft || { ...poster })}><Pencil size={14} /> Edit Poster</button>
          </div>
          {draft && (
            <form style={{ marginTop: 14 }} onSubmit={(event) => { event.preventDefault(); savePoster(); }}>
              {field('heading', 'Heading')}
              {field('message', 'Message', { area: true })}
              {field('facilities', 'Facilities (comma separated)')}
              {field('phone', 'Phone')}
              <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={Boolean(draft.showPhone)} onChange={e => setDraft({ ...draft, showPhone: e.target.checked })} /> Show phone on the poster
              </label>
              {field('address', 'Address')}
              <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={Boolean(draft.showAddress)} onChange={e => setDraft({ ...draft, showAddress: e.target.checked })} /> Show address on the poster
              </label>
              <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={draft.showLogo !== false} onChange={e => setDraft({ ...draft, showLogo: e.target.checked })} /> Show library logo
              </label>
              <label className="form-group" style={{ display: 'block', marginBottom: 8 }}>
                <span className="form-label">Theme</span>
                <select className="form-select" value={draft.theme} onChange={e => setDraft({ ...draft, theme: e.target.value })}>
                  {Object.entries(POSTER_THEMES).map(([id, theme]) => <option key={id} value={id}>{theme.name}</option>)}
                </select>
              </label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>The enquiry link stays the same while you edit the poster.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Save poster</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
