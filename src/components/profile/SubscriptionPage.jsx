import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import {
  cycleLabel, daysLeftUntil, formatPlanDate, historyTypeLabel, statusPillLabel,
} from '../../utils/subscriptionLock';

const inr = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const minorInr = (minor, currency = 'INR') => {
  const n = Number(minor || 0) / 100;
  return `${currency === 'INR' ? '₹' : ''}${n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const pillClass = (status) => {
  const key = String(status || '').toLowerCase();
  if (key === 'active' || key === 'paid' || key === 'trialing') return 'os-pill os-pill-active';
  if (key === 'trial') return 'os-pill os-pill-trial';
  if (key === 'expired' || key === 'failed' || key === 'void' || key === 'cancelled') return 'os-pill os-pill-expired';
  return 'os-pill os-pill-open';
};

export function SubscriptionPage({ onBack, onPaid, canPay = true, locked = false }) {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [useWallet, setUseWallet] = useState(true);
  const [interval, setInterval] = useState('month');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [planId, setPlanId] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [sum, hist, plan] = await Promise.all([
        api.subscriptionSummary(),
        api.subscriptionHistory(),
        api.softwarePlan().catch(() => null),
      ]);
      setSummary(sum);
      setHistory(hist?.items || []);
      const list = plan?.plans || [];
      setPlans(list);
      setInterval(sum?.billingCycle === 'year' ? 'year' : 'month');
      setPlanId(prev => prev || list.find(p => p.planId !== sum?.planId)?.planId || list[0]?.planId || '');
    } catch (e) {
      setError(e.message || 'Could not load your subscription');
      setSummary(null);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canPay) {
      setLoading(false);
      setSummary(null);
      setHistory(null);
      return undefined;
    }
    load();
  }, [canPay]);

  useEffect(() => {
    if (!canPay) return undefined;
    if (sessionStorage.getItem('libos_checkout_pending') !== '1') return undefined;
    sessionStorage.removeItem('libos_checkout_pending');
    let cancel = false;
    (async () => {
      await onPaid?.();
      if (!cancel) await load();
    })();
    return () => { cancel = true; };
  }, []);

  const quotePlanId = upgradeOpen ? planId : summary?.planId;
  const quoteInterval = upgradeOpen ? interval : (summary?.billingCycle === 'year' ? 'year' : 'month');
  useEffect(() => {
    if (!canPay || !quotePlanId) { setQuote(null); return undefined; }
    let cancel = false;
    setQuoteError('');
    api.softwarePlanQuote({ planId: quotePlanId, interval: quoteInterval, useWallet })
      .then(q => { if (!cancel) setQuote(q); })
      .catch(e => { if (!cancel) { setQuote(null); setQuoteError(e.message || 'Could not load the quote'); } });
    return () => { cancel = true; };
  }, [canPay, quotePlanId, quoteInterval, useWallet]);

  const expiryText = formatPlanDate(summary?.expiry);
  const left = summary ? daysLeftUntil(summary.expiry) : 0;
  const expired = summary?.status === 'expired' || summary?.locked;
  const open = summary?.status === 'active' || summary?.status === 'trial';
  const yearlyOk = useMemo(() => plans.some(p => p.priceYearly != null), [plans]);

  const pay = async (kind) => {
    setBusy(true);
    setError('');
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}#/profile`;
      const payInterval = kind === 'upgrade' ? interval : (summary?.billingCycle === 'year' ? 'year' : 'month');
      const body = { interval: payInterval, useWallet, returnUrl };
      let result;
      if (kind === 'early') result = await api.subscriptionRenewEarly(body);
      else if (kind === 'upgrade') result = await api.subscriptionUpgrade({ ...body, planId });
      else result = await api.subscriptionRenew(body);
      const url = result?.checkout?.url;
      if (url) {
        sessionStorage.setItem('libos_checkout_pending', '1');
        window.location.href = url;
        return;
      }
      if (result?.walletOnly) toast.success('Paid from your wallet');
      else if (result?.changeType === 'downgrade') toast.success('Downgrade scheduled for the next period');
      else toast.success('Plan updated');
      await onPaid?.();
      await load();
    } catch (e) {
      setError(e.message || 'Payment could not start');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="os-profile-inner">
      <div className="os-profile-top">
        <button type="button" className="os-back" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2>Subscription</h2>
      </div>
      {!canPay && locked && (
        <div className="os-card os-card-pad">Your library's plan has expired. Ask the owner to renew.</div>
      )}
      {!canPay && !locked && (
        <div className="os-card os-card-pad os-note">Only the library owner can renew or upgrade. You can still contact support from the profile menu.</div>
      )}
      {canPay && error && <div className="os-error" role="alert">{error}</div>}
      {canPay && loading && <div className="os-card os-card-pad os-note">Loading your plan…</div>}
      {canPay && !loading && !summary && !error && <div className="os-card os-card-pad os-note">No subscription on this library yet.</div>}
      {canPay && !loading && summary && (
        <section className="os-card os-card-pad">
          <div className="os-plan-head">
            <div>
              <div className="os-note">Current plan</div>
              <h3 style={{ margin: '4px 0 0', fontSize: 20 }}>{summary.planName || 'No plan'}</h3>
              <div className="os-price">{inr(summary.price)}<span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}> / {cycleLabel(summary.billingCycle)}</span></div>
            </div>
            <span className={pillClass(summary.status)}>{statusPillLabel(summary.status)}</span>
          </div>
          <p className="os-muted">{expiryText ? `Expires ${expiryText}` : 'No expiry date'} · {left} {left === 1 ? 'day' : 'days'} left</p>
        </section>
      )}
      {expired && (
        <div className="os-banner" role="status">
          {expiryText ? `Your plan expired on ${expiryText}. Renew to unlock your library.` : 'Your plan has expired. Renew to unlock your library.'}
        </div>
      )}
      {canPay && summary && (
        <section className="os-card os-card-pad" style={{ display: 'grid', gap: 12 }}>
          <div className="os-actions">
            {expired && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => pay('renew')}>Renew</button>}
            {open && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => pay('early')}>Renew early</button>
            )}
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setUpgradeOpen(v => !v)}>Upgrade plan</button>
          </div>
          {open && <p className="os-note">Renew early adds a new period after {expiryText || 'the current expiry'}.</p>}
          {upgradeOpen && (
            <div className="os-plan-pick">
              {plans.length === 0 && <div className="os-note">No plans are available.</div>}
              {plans.map(p => (
                <label key={p.planId} className={planId === p.planId ? 'on' : ''}>
                  <input type="radio" name="os-plan" checked={planId === p.planId} onChange={() => setPlanId(p.planId)} />
                  <span><strong>{p.name}</strong> · {inr(p.priceMonthly)}/month{p.priceYearly != null ? ` or ${inr(p.priceYearly)}/year` : ''}</span>
                </label>
              ))}
              {yearlyOk && (
                <label className="os-check">
                  <input type="checkbox" checked={interval === 'year'} onChange={e => setInterval(e.target.checked ? 'year' : 'month')} />
                  Yearly billing
                </label>
              )}
              <button type="button" className="btn btn-primary" disabled={busy || !planId} onClick={() => pay('upgrade')}>{busy ? 'Working…' : 'Continue with this plan'}</button>
            </div>
          )}
          <div className="os-card" style={{ boxShadow: 'none', border: '1px solid var(--border-light)' }}>
            <div className="os-card-pad" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><Wallet size={16} /> Wallet</div>
              <div className="os-note">Balance {inr(summary.walletBalance)}</div>
              <label className="os-check">
                <input type="checkbox" checked={useWallet} onChange={e => setUseWallet(e.target.checked)} />
                Use wallet balance
              </label>
              {quoteError && <div className="os-error">{quoteError}</div>}
              {quote && (
                <div className="os-quote">
                  <div><span>Change</span><strong style={{ textTransform: 'capitalize' }}>{quote.changeType}</strong></div>
                  <div><span>Total</span><span>{minorInr(quote.totalMinor, quote.currency)}</span></div>
                  <div><span>Wallet applied</span><span>-{minorInr(quote.walletAppliedMinor, quote.currency)}</span></div>
                  <div><span>Pay now</span><strong>{minorInr(quote.gatewayDueMinor, quote.currency)}</strong></div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      {canPay && <section>
        <h3 style={{ fontSize: 15, margin: '4px 0 8px' }}>History</h3>
        {loading && <div className="os-note">Loading history…</div>}
        {!loading && history && history.length === 0 && <div className="os-card os-card-pad os-note">No subscription history yet.</div>}
        {!loading && history && history.length > 0 && (
          <div className="os-history">
            {history.map((item, i) => (
              <article key={`${item.transactionDate || 't'}-${item.type}-${i}`} className="os-card">
                <div className="os-history-top">
                  <strong>{inr(item.amount)}</strong>
                  <span className={pillClass(item.status)}>{item.status || '—'}</span>
                </div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>{historyTypeLabel(item.type)}</div>
                <div className="os-note">{item.plan || 'Plan'}</div>
                <div className="os-note">{formatPlanDate(item.periodFrom) || '—'} – {formatPlanDate(item.periodTo) || '—'}</div>
                <div className="os-note">Transaction {formatPlanDate(item.transactionDate) || '—'}</div>
              </article>
            ))}
          </div>
        )}
      </section>}
    </div>
  );
}
