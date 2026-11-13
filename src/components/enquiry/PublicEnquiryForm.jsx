import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../utils/api';
import { indianMobileError } from '../../utils/enquiry';

async function publicEnquiry(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error('Could not reach the library. Check your connection and try again.');
    error.network = true;
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error || 'Something went wrong. Please try again.');
    error.status = res.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

function logoNode(logo) {
  const value = typeof logo === 'string' ? logo.trim() : '';
  if (!value) return null;
  if (/^(https?:|data:image\/)/i.test(value)) {
    return <img src={value} alt="" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 12 }} />;
  }
  return <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">{value}</div>;
}

export function PublicEnquiryForm({ token }) {
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [preferred, setPreferred] = useState('Not sure');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [mobileTouched, setMobileTouched] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setPhase('loading');
    setLoadError('');
    publicEnquiry(`/public/enquiry/${encodeURIComponent(token)}`)
      .then((data) => { setInfo(data); setPhase('form'); })
      .catch((error) => {
        if (error.status === 404) setPhase('missing');
        else if (error.status === 429 || error.code === 'rate_limited') {
          setPhase('limited');
          setLoadError(error.message);
        } else {
          setPhase('error');
          setLoadError(error.message || 'Could not reach the library. Check your connection and try again.');
        }
      });
  };

  useEffect(() => { load(); }, [token]);

  const choices = useMemo(() => {
    const names = [...(info?.shifts || []), ...(info?.plans || [])].map(v => String(v || '').trim()).filter(Boolean);
    return ['Not sure', ...new Set(names)];
  }, [info]);

  const mobileMessage = mobileTouched || mobile ? indianMobileError(mobile) : '';

  const submit = async (event) => {
    event.preventDefault();
    setMobileTouched(true);
    setSubmitError('');
    if (!name.trim()) { setSubmitError('Name is required'); return; }
    const mobileProblem = indianMobileError(mobile);
    if (mobileProblem) { setSubmitError(mobileProblem); return; }
    if (message.length > 500) { setSubmitError('Message must be 500 characters or less'); return; }
    setBusy(true);
    try {
      await publicEnquiry(`/public/enquiry/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: { name: name.trim(), mobile, email: email.trim(), preferred, message: message.trim(), website },
      });
      setPhase('done');
    } catch (error) {
      if (error.status === 404) setPhase('missing');
      else if (error.status === 429 || error.code === 'rate_limited') setSubmitError('Too many enquiries right now. Please try again later.');
      else setSubmitError(error.network ? error.message : (error.message || 'Could not send your enquiry. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', justifyContent: 'center', padding: '24px 16px 40px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <article className="premium-card" style={{ padding: 24, borderRadius: 20 }}>
          {phase === 'loading' && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading enquiry form…</p>}

          {phase === 'missing' && (
            <>
              <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Link not found</h1>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 15 }}>This enquiry link is not valid. Ask the library for a new QR code.</p>
            </>
          )}

          {phase === 'limited' && (
            <>
              <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Please try later</h1>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 15 }}>{loadError || 'Too many enquiries right now. Please try again later.'}</p>
            </>
          )}

          {phase === 'error' && (
            <>
              <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Could not open the form</h1>
              <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 15 }}>{loadError}</p>
              <button type="button" className="btn btn-primary" onClick={load} style={{ width: '100%', justifyContent: 'center' }}>Try again</button>
            </>
          )}

          {phase === 'done' && (
            <>
              <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Thank you! The library will contact you soon.</h1>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 15 }}>{info?.libraryName ? `${info.libraryName} has your enquiry.` : 'Your enquiry has been sent.'}</p>
            </>
          )}

          {phase === 'form' && info && (
            <form onSubmit={submit}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
                {logoNode(info.logo)}
                <h1 style={{ fontSize: 24, lineHeight: 1.2, margin: 0 }}>{info.libraryName || 'Library enquiry'}</h1>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>Tell the library you are interested. They will contact you.</p>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-name">Name *</label>
                <input id="enquiry-name" className="form-input" style={{ borderRadius: 10, minHeight: 44 }} autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-mobile">Mobile *</label>
                <input id="enquiry-mobile" className="form-input" style={{ borderRadius: 10, minHeight: 44 }} type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" value={mobile} onBlur={() => setMobileTouched(true)} onChange={e => setMobile(e.target.value)} required aria-invalid={Boolean(mobileMessage)} />
                {mobileMessage && <span role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{mobileMessage}</span>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-email">Email</label>
                <input id="enquiry-email" className="form-input" style={{ borderRadius: 10, minHeight: 44 }} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-preferred">Preferred shift or plan</label>
                <select id="enquiry-preferred" className="form-select" style={{ borderRadius: 10, minHeight: 44 }} value={preferred} onChange={e => setPreferred(e.target.value)}>
                  {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-message">Message</label>
                <textarea id="enquiry-message" className="form-textarea" style={{ borderRadius: 10, minHeight: 96 }} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'right' }}>{message.length}/500</span>
              </div>
              <input name="website" value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }} />
              {submitError && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{submitError}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center', minHeight: 46, borderRadius: 10 }}>
                {busy ? 'Sending…' : 'Send enquiry'}
              </button>
            </form>
          )}
        </article>
        <p style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>Powered by My Library OS</p>
      </div>
    </div>
  );
}
