import React, { useEffect, useState } from 'react';
import { API_BASE } from '../../utils/api';
import { indianMobileError } from '../../utils/enquiry';
import { branchSectionState, genderError, viewOnlyPlans } from '../../utils/enquiryForm';
import { compressEnquiryImage } from '../../utils/compressEnquiryImage';

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
  const [gender, setGender] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [branchId, setBranchId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [photo, setPhoto] = useState('');
  const [mobileTouched, setMobileTouched] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setPhase('loading');
    setLoadError('');
    publicEnquiry(`/public/enquiry/${encodeURIComponent(token)}`)
      .then((data) => {
        setInfo(data);
        const state = branchSectionState(data, '', '');
        setBranchId(state.branch.value);
        setSectionId(state.section.value);
        setPhase('form');
      })
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

  const place = info ? branchSectionState(info, branchId, sectionId) : null;
  const plans = viewOnlyPlans(info?.plans);
  const mobileMessage = mobileTouched || mobile ? indianMobileError(mobile) : '';

  const onBranch = (id) => {
    setBranchId(id);
    const next = branchSectionState(info, id, '');
    setSectionId(next.section.value);
  };

  const onFile = async (file, setter) => {
    setSubmitError('');
    if (!file) { setter(''); return; }
    try {
      setter(await compressEnquiryImage(file));
    } catch (error) {
      setter('');
      setSubmitError(error.message || 'Could not use that image');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setMobileTouched(true);
    setSubmitError('');
    if (!name.trim()) { setSubmitError('Name is required'); return; }
    const mobileProblem = indianMobileError(mobile);
    if (mobileProblem) { setSubmitError(mobileProblem); return; }
    const genderProblem = genderError(gender);
    if (genderProblem) { setSubmitError(genderProblem); return; }
    if (message.length > 500) { setSubmitError('Message must be 500 characters or less'); return; }
    if (place && !place.branch.hidden && !place.branch.value) { setSubmitError('Choose a branch'); return; }
    if (place && !place.section.hidden && !place.section.value) { setSubmitError('Choose a section'); return; }
    setBusy(true);
    try {
      await publicEnquiry(`/public/enquiry/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: {
          name: name.trim(),
          mobile,
          gender,
          email: email.trim(),
          message: message.trim(),
          website,
          branchId: place?.branch.value || '',
          sectionId: place?.section.value || '',
          ...(aadhaar ? { aadhaar } : {}),
          ...(photo ? { photo } : {}),
        },
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

  const choiceField = (id, label, control, onChange) => {
    if (!control || control.hidden) return null;
    if (control.locked) {
      return (
        <div className="form-group">
          <span className="form-label">{label}</span>
          <input className="form-input" style={{ borderRadius: 10, minHeight: 44 }} value={control.options[0]?.name || ''} readOnly aria-readonly="true" />
        </div>
      );
    }
    return (
      <div className="form-group">
        <label className="form-label" htmlFor={id}>{label} *</label>
        <select id={id} className="form-select" style={{ borderRadius: 10, minHeight: 44 }} value={control.value} onChange={e => onChange(e.target.value)} required>
          <option value="">Select</option>
          {control.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
    );
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

              {plans.length > 0 && (
                <section aria-label="Membership plans" style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Membership plans</h2>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                    {plans.map(plan => (
                      <li key={plan.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 12px', fontSize: 14 }}>
                        {plan.name}{plan.price != null ? ` · ₹${plan.price}` : ''}
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>For information only. You cannot choose or buy a plan on this form.</p>
                </section>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-name">Name *</label>
                <input id="enquiry-name" className="form-input" style={{ borderRadius: 10, minHeight: 44 }} autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-mobile">Mobile *</label>
                <input id="enquiry-mobile" className="form-input" style={{ borderRadius: 10, minHeight: 44 }} type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" value={mobile} onBlur={() => setMobileTouched(true)} onChange={e => setMobile(e.target.value)} required aria-invalid={Boolean(mobileMessage)} />
                {mobileMessage && <span role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{mobileMessage}</span>}
              </div>
              <fieldset className="form-group" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="form-label">Gender *</legend>
                {['male', 'female', 'other'].map(value => (
                  <label key={value} style={{ display: 'inline-flex', gap: 6, marginRight: 12, minHeight: 44, alignItems: 'center' }}>
                    <input type="radio" name="gender" value={value} checked={gender === value} onChange={() => setGender(value)} required />
                    {value[0].toUpperCase() + value.slice(1)}
                  </label>
                ))}
              </fieldset>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-email">Email</label>
                <input id="enquiry-email" className="form-input" style={{ borderRadius: 10, minHeight: 44 }} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              {choiceField('enquiry-branch', 'Branch', place?.branch, onBranch)}
              {choiceField('enquiry-section', 'Section', place?.section, setSectionId)}
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-aadhaar">Aadhaar</label>
                <input id="enquiry-aadhaar" className="form-input" style={{ borderRadius: 10 }} type="file" accept="image/jpeg,image/webp" onChange={e => onFile(e.target.files?.[0], setAadhaar)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enquiry-photo">Student photo</label>
                <input id="enquiry-photo" className="form-input" style={{ borderRadius: 10 }} type="file" accept="image/jpeg,image/webp" onChange={e => onFile(e.target.files?.[0], setPhoto)} />
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
