// Issue #15: owner signup — email code or Google, then plan, then library. Payment step when due.
import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const limit = (n) => (n ? n.toLocaleString() : 'Unlimited');

export function SignupPanel({ plans = [], googleSignup = false, paymentsConfigured = false, googlePendingToken = '', onDone, onBack }) {
  const [step, setStep] = useState(googlePendingToken ? 2 : 1); // 1 email, 2 details, 3 payment
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pendingToken, setPendingToken] = useState(googlePendingToken || '');
  const [planId, setPlanId] = useState(plans[0]?.planId || '');
  const [interval, setInterval] = useState('month');
  const [name, setName] = useState('');
  const [libraryName, setLibraryName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(googlePendingToken ? 'Google verified. Choose a plan and name your library.' : '');
  const [sessionResult, setSessionResult] = useState(null);
  const plan = plans.find(p => p.planId === planId);
  const viaGoogle = Boolean(pendingToken);

  useEffect(() => {
    if (googlePendingToken) {
      setPendingToken(googlePendingToken);
      setStep(2);
      setInfo('Google verified. Choose a plan and name your library.');
    }
  }, [googlePendingToken]);

  const run = async (fn) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const sendCode = (e) => { e.preventDefault(); run(async () => { const r = await api.signupStart(email.trim()); setInfo(r.message || 'Code sent.'); setStep(2); }); };

  const startGoogle = () => {
    window.location.href = '/api/auth/google/start?signup=1';
  };

  const finish = (e) => {
    e.preventDefault();
    if (!viaGoogle) {
      if (password.length < 8) return setError('Password must be at least 8 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    } else if (password && password.length < 8) {
      return setError('Password must be at least 8 characters.');
    } else if (password && password !== confirm) {
      return setError('Passwords do not match.');
    }
    if (plans.length && !planId) return setError('Choose a plan.');
    run(async () => {
      let result;
      if (viaGoogle) {
        result = await api.signupCompleteGoogle({
          pendingToken,
          name: name.trim() || undefined,
          libraryName: libraryName.trim(),
          password: password || undefined,
          planId: planId || undefined,
          interval,
        });
      } else {
        result = await api.signupComplete({
          email: email.trim(), code: code.trim(), name: name.trim(),
          libraryName: libraryName.trim(), password, planId: planId || undefined, interval,
        });
      }
      if (result.needsPayment) {
        setSessionResult(result);
        setStep(3);
      } else {
        onDone(result);
      }
    });
  };

  const payNow = () => run(async () => {
    try {
      const r = await api.subscriptionCheckout(typeof window !== 'undefined' ? window.location.origin : undefined);
      if (r.url) { window.location.href = r.url; return; }
      setError(r.error || 'Checkout is not ready yet.');
    } catch (e) {
      // Provider not configured — still let them into the app; #14 lock will remind them.
      setError(e.message || 'Online payment is not set up yet. You can continue and pay later.');
    }
  });

  const continueWithoutPay = () => {
    if (sessionResult) onDone(sessionResult);
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
          {googleSignup && (
            <>
              <div style={{ textAlign: 'center', margin: '12px 0', fontSize: 12, color: 'var(--text-tertiary)' }}>or</div>
              <button type="button" id="signup-google" className="btn btn-secondary" onClick={startGoogle} style={{ width: '100%', justifyContent: 'center', gap: 8 }}>
                Continue with Google
              </button>
            </>
          )}
        </form>
      )}
      {step === 2 && (
        <form onSubmit={finish}>
          {info && <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>{info}{!viaGoogle && email ? ` (${email})` : ''}</p>}
          {!viaGoogle && (
            <div className="form-group">
              <label className="form-label" htmlFor="signup-code">Code from email</label>
              <input id="signup-code" className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
            </div>
          )}
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
          <div className="form-group"><label className="form-label" htmlFor="signup-name">Your name</label><input id="signup-name" className="form-input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required={!viaGoogle} /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-library">Library name</label><input id="signup-library" className="form-input" value={libraryName} onChange={e => setLibraryName(e.target.value)} required /></div>
          {!viaGoogle ? (
            <>
              <div className="form-group"><label className="form-label" htmlFor="signup-password">Password</label><input id="signup-password" className="form-input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
              <div className="form-group"><label className="form-label" htmlFor="signup-confirm">Confirm password</label><input id="signup-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
            </>
          ) : (
            <details style={{ marginBottom: 12, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Also set a password (optional)</summary>
              <div className="form-group" style={{ marginTop: 8 }}><label className="form-label" htmlFor="signup-password">Password</label><input id="signup-password" className="form-input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></div>
              <div className="form-group"><label className="form-label" htmlFor="signup-confirm">Confirm password</label><input id="signup-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
            </details>
          )}
          {plan && plan.priceMonthly > 0 && !plan.trialDays && (
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
              {paymentsConfigured
                ? 'After creating your library you will be asked to pay online.'
                : 'Online payment is not connected yet. Your library is created now; Super Admin will finish payment setup.'}
            </p>
          )}
          {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create library'}</button>
          {!viaGoogle && <button type="button" className="btn btn-ghost" onClick={() => { setStep(1); setCode(''); }} style={{ width: '100%', justifyContent: 'center', fontSize: 13, marginTop: 6 }}>Use a different email</button>}
        </form>
      )}
      {step === 3 && (
        <div data-testid="signup-payment-step">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>
            Your library is ready. Complete payment to unlock editing{paymentsConfigured ? '.' : ' once online payments are connected.'}
          </p>
          {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {paymentsConfigured && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={payNow} style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}>
              {busy ? 'Opening checkout…' : 'Pay now'}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={continueWithoutPay} style={{ width: '100%', justifyContent: 'center' }}>
            Continue to library
          </button>
        </div>
      )}
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <button type="button" className="btn btn-ghost" onClick={onBack} style={{ fontSize: 13, padding: '4px 8px' }}>Back to sign in</button>
      </div>
    </div>
  );
}
