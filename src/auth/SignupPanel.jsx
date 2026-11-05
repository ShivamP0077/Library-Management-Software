// Issue #15: owner signup — email code, then plan, then library details. Shown only when the server enables it.
import React, { useState } from 'react';
import { api } from '../utils/api';

const limit = (n) => (n ? n.toLocaleString() : 'Unlimited');

export function SignupPanel({ plans = [], onDone, onBack }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.planId || '');
  const [interval, setInterval] = useState('month');
  const [name, setName] = useState('');
  const [libraryName, setLibraryName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const plan = plans.find(p => p.planId === planId);

  const run = async (fn) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const sendCode = (e) => { e.preventDefault(); run(async () => { const r = await api.signupStart(email.trim()); setInfo(r.message || 'Code sent.'); setStep(2); }); };
  const finish = (e) => {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    if (plans.length && !planId) return setError('Choose a plan.');
    run(async () => onDone(await api.signupComplete({ email: email.trim(), code: code.trim(), name: name.trim(), libraryName: libraryName.trim(), password, planId: planId || undefined, interval })));
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>Create your library account</h2>
      {step === 1 && (
        <form onSubmit={sendCode}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>We'll email you a 6-digit code to confirm it's you.</p>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-email">Email</label>
            <input id="signup-email" className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      )}
      {step === 2 && (
        <form onSubmit={finish}>
          {info && <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>{info} ({email})</p>}
          <div className="form-group">
            <label className="form-label" htmlFor="signup-code">Code from email</label>
            <input id="signup-code" className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
          </div>
          {plans.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
              <legend className="form-label">Choose a plan</legend>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {plans.map(p => (
                  <label key={p.planId} data-signup-plan={p.planId} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${planId === p.planId ? 'var(--brand-primary, #2563eb)' : 'var(--border-light, #e5e7eb)'}`, borderRadius: 8, padding: 10, fontSize: 13, cursor: 'pointer' }}>
                    <input type="radio" name="signup-plan" checked={planId === p.planId} onChange={() => setPlanId(p.planId)} />
                    <span>
                      <strong>{p.name}</strong> · ₹{Number(p.priceMonthly).toLocaleString()}/month{p.priceYearly ? ` or ₹${p.priceYearly.toLocaleString()}/year` : ''}{p.trialDays ? ` · ${p.trialDays}-day free trial` : ''}
                      <br /><span style={{ color: 'var(--text-tertiary)' }}>Students {limit(p.studentLimit)} · Staff {limit(p.staffLimit)} · Branches {limit(p.branchLimit)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {plan?.priceYearly ? (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
                  <input type="checkbox" checked={interval === 'year'} onChange={e => setInterval(e.target.checked ? 'year' : 'month')} /> Pay yearly
                </label>
              ) : null}
            </fieldset>
          )}
          <div className="form-group"><label className="form-label" htmlFor="signup-name">Your name</label><input id="signup-name" className="form-input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-library">Library name</label><input id="signup-library" className="form-input" value={libraryName} onChange={e => setLibraryName(e.target.value)} required /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-password">Password</label><input id="signup-password" className="form-input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-confirm">Confirm password</label><input id="signup-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
          {plan && plan.priceMonthly > 0 && !plan.trialDays && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 12px' }}>Online payment isn't set up yet. Your library is created now and we'll contact you about payment.</p>}
          {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create library'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setStep(1); setCode(''); }} style={{ width: '100%', justifyContent: 'center', fontSize: 13, marginTop: 6 }}>Use a different email</button>
        </form>
      )}
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <button type="button" className="btn btn-ghost" onClick={onBack} style={{ fontSize: 13, padding: '4px 8px' }}>Back to sign in</button>
      </div>
    </div>
  );
}
