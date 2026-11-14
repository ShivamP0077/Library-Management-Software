// Issue #15: owner signup — email code or Google, then plan, then library. Payment step when due.
import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { SignupPlanPicker } from './SignupPlanPicker';

export function SignupPanel({ plans = [], googleSignup = false, mobileSignupAvailable = false, paymentsConfigured = false, googlePendingToken = '', onDone, onBack }) {
  const [step, setStep] = useState(googlePendingToken ? 2 : 1); // 1 verify, 2 details, 3 payment
  const [channel, setChannel] = useState('email'); // email | mobile
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [pendingToken, setPendingToken] = useState(googlePendingToken || '');
  const [planId, setPlanId] = useState(plans[0]?.planId || '');
  const [interval, setInterval] = useState('month');
  const [touchedInterval, setTouchedInterval] = useState(false);
  const [name, setName] = useState('');
  const [libraryName, setLibraryName] = useState('');
  const [city, setCity] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendWait, setResendWait] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(googlePendingToken ? 'Google verified. Choose a plan and name your library.' : '');
  const [sessionResult, setSessionResult] = useState(null);
  const plan = plans.find(p => p.planId === planId);
  const viaGoogle = Boolean(pendingToken);

  useEffect(() => {
    if (!touchedInterval) setInterval(plan?.priceMonthly != null ? 'month' : 'year');
  }, [planId, touchedInterval]);

  useEffect(() => {
    if (!mobileSignupAvailable && channel === 'mobile') setChannel('email');
  }, [mobileSignupAvailable, channel]);

  useEffect(() => {
    if (step === 2 && !viaGoogle) setResendWait(60);
  }, [step, viaGoogle]);

  useEffect(() => {
    if (resendWait <= 0) return undefined;
    const timer = setTimeout(() => setResendWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendWait]);

  useEffect(() => {
    if (googlePendingToken) {
      setPendingToken(googlePendingToken);
      setStep(2);
      setInfo('Google verified. Choose a plan and name your library.');
    }
  }, [googlePendingToken]);

  const run = async (fn) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const sendCode = (e) => {
    e.preventDefault();
    run(async () => {
      const r = channel === 'mobile' && mobileSignupAvailable
        ? await api.signupStartMobile(mobile.trim())
        : await api.signupStart(email.trim());
      setInfo(r.message || 'Code sent.');
      setStep(2);
    });
  };

  const resendCode = () => {
    run(async () => {
      const r = channel === 'mobile' && mobileSignupAvailable
        ? await api.signupStartMobile(mobile.trim())
        : await api.signupStart(email.trim());
      setCode('');
      setResendWait(60);
      setInfo(r.message ? `${r.message} A new code was sent. The old code no longer works.` : 'A new code was sent. The old code no longer works.');
    });
  };

  const startGoogle = () => {
    window.location.href = `${api.googleStartUrl()}?signup=1`;
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
          city: city.trim() || undefined,
          referralCode: referralCode.trim() || undefined,
          password: password || undefined,
          planId: planId || undefined,
          interval,
        });
      } else {
        if (channel === 'mobile' && mobileSignupAvailable) {
          result = await api.signupCompleteMobile({
            mobile: mobile.trim(), email: email.trim() || undefined, code: code.trim(), name: name.trim(),
            city: city.trim() || undefined, referralCode: referralCode.trim() || undefined,
            libraryName: libraryName.trim(), password, planId: planId || undefined, interval,
          });
        } else {
          result = await api.signupComplete({
            email: email.trim(), mobile: mobile.trim() || undefined, code: code.trim(), name: name.trim(),
            city: city.trim() || undefined, referralCode: referralCode.trim() || undefined,
            libraryName: libraryName.trim(), password, planId: planId || undefined, interval,
          });
        }
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
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>{mobileSignupAvailable ? 'Verify your email or mobile to create your owner account.' : 'Verify your email to create your owner account.'}</p>
          {mobileSignupAvailable && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" className={`btn ${channel === 'email' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setChannel('email')}>Email</button>
              <button type="button" className={`btn ${channel === 'mobile' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setChannel('mobile')}>Mobile</button>
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="signup-email">{channel === 'mobile' && mobileSignupAvailable ? 'Mobile number' : 'Email'}</label>
            {channel === 'mobile' && mobileSignupAvailable ? (
              <>
                <input id="signup-mobile" className="form-input" type="tel" inputMode="tel" autoComplete="tel" value={mobile} onChange={e => setMobile(e.target.value)} required />
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '8px 0 0' }}>We'll send a 6-digit code on WhatsApp.</p>
              </>
            ) : (
              <input id="signup-email" className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            )}
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
        <form onSubmit={finish} className="signup-fields">
          <style>{`
            .signup-fields .form-input, .signup-fields .form-select { border-radius: 10px; min-height: 44px; }
            .signup-fields .form-group { margin-bottom: 14px; }
          `}</style>
          {info && <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>{info}{!viaGoogle && (channel === 'mobile' ? mobile : email) ? ` (${channel === 'mobile' ? mobile : email})` : ''}</p>}
          {!viaGoogle && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="signup-code">6-digit code</label>
                <input id="signup-code" className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
                <button type="button" className="btn btn-secondary" onClick={resendCode} disabled={busy || resendWait > 0} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
                  {resendWait > 0 ? `Resend code (${resendWait}s)` : 'Resend code'}
                </button>
              </div>
              {channel === 'mobile' && mobileSignupAvailable && (
                <div className="form-group">
                  <label className="form-label" htmlFor="signup-email-optional">Email (optional)</label>
                  <input id="signup-email-optional" className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
              )}
            </>
          )}
          <SignupPlanPicker
            plans={plans}
            planId={planId}
            interval={interval}
            onInterval={(next) => { setTouchedInterval(true); setInterval(next); }}
            onSelect={(id) => {
              setPlanId(id);
              const next = plans.find(p => p.planId === id);
              if (interval === 'year' && !next?.priceYearly) setInterval('month');
            }}
          />
          <div className="form-group"><label className="form-label" htmlFor="signup-name">Your name</label><input id="signup-name" className="form-input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required={!viaGoogle} /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-library">Library name</label><input id="signup-library" className="form-input" value={libraryName} onChange={e => setLibraryName(e.target.value)} required /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-city">City</label><input id="signup-city" className="form-input" value={city} onChange={e => setCity(e.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="signup-referral">Referral code (optional)</label><input id="signup-referral" className="form-input" value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())} /></div>
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
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center', minHeight: 46, borderRadius: 10, fontWeight: 700 }}>{busy ? 'Creating…' : 'Create library'}</button>
          {!viaGoogle && <button type="button" className="btn btn-ghost" onClick={() => { setStep(1); setCode(''); }} style={{ width: '100%', justifyContent: 'center', fontSize: 13, marginTop: 6 }}>Use a different {channel === 'mobile' && mobileSignupAvailable ? 'mobile' : 'email'}</button>}
        </form>
      )}
      {step === 3 && (
        <div data-testid="signup-payment-step">
          {sessionResult?.message && (
            <div role="status" style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              {sessionResult.message}
            </div>
          )}
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
