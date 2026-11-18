import React, { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Download, Gift, Share2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import { PAYMENT_NOT_READY_MESSAGE } from '../../utils/support';
import { referralShareUrl, shareReferralLink } from '../../utils/referralShare';

const PRESETS = ['500', '1000', '2000'];

const fmt = (minor, currency = 'INR') => `${currency === 'INR' ? '₹' : ''}${(Number(minor || 0) / 100).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency === 'INR' ? '' : ` ${currency}`}`;
const dateIST = value => value ? `${new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : '—';
const invoiceMoney = (value, currency) => value == null || !currency ? '—' : fmt(value, currency);

export function WalletPage({ onBack, canPay = true, libraryName = 'your library' }) {
  const [plan, setPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [referral, setReferral] = useState(null);
  const [referralError, setReferralError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [payBlocked, setPayBlocked] = useState(false);
  const [amount, setAmount] = useState('1000');
  const [confirming, setConfirming] = useState(false);
  const [deliveringId, setDeliveringId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [planRes, hist, inv, refs] = await Promise.all([
        api.softwarePlan(),
        api.walletHistory(50).catch(() => []),
        api.softwarePlanInvoices().catch(() => []),
        api.referrals().then(value => ({ value })).catch(e => ({ error: e.message || 'Could not load referrals' })),
      ]);
      setPlan(planRes);
      setHistory(hist || []);
      setInvoices((inv || []).filter(row => row.kind === 'topup'));
      setReferral(refs.value || null);
      setReferralError(refs.error || '');
    } catch (e) {
      setError(e.code === 'billing_not_configured' ? PAYMENT_NOT_READY_MESSAGE : (e.message || 'Could not load your wallet'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canPay) { setLoading(false); return undefined; }
    load();
  }, [canPay]);

  useEffect(() => {
    if (!canPay) return undefined;
    if (sessionStorage.getItem('libos_wallet_topup_pending') !== '1') return undefined;
    sessionStorage.removeItem('libos_wallet_topup_pending');
    load();
  }, [canPay]);

  const w = plan?.wallet;
  const currency = w?.currency || plan?.billingConfig?.currency || 'INR';
  const billingNotReady = Boolean(payBlocked || plan?.billingConfig?.configured === false || !plan?.providersConfigured);
  const link = referral?.code ? referralShareUrl(referral.code, typeof window !== 'undefined' ? window.location.origin : '') : '';
  const receipts = invoices;

  const askTopup = () => {
    const value = Number(amount);
    if (!(value > 0)) {
      setError('Enter a valid top-up amount');
      return;
    }
    setError('');
    setConfirming(true);
  };

  const startTopup = async () => {
    setBusy(true);
    setError('');
    try {
      const value = Number(amount);
      if (!(value > 0)) throw new Error('Enter a valid top-up amount');
      const returnUrl = `${window.location.origin}${window.location.pathname}#/profile`;
      const result = await api.walletTopup({ amount: value, returnUrl });
      setConfirming(false);
      if (result.checkout?.url) {
        sessionStorage.setItem('libos_wallet_topup_pending', '1');
        window.location.href = result.checkout.url;
        return;
      }
      toast.success('Top-up started');
      await load();
    } catch (e) {
      if (e.code === 'billing_not_configured') setPayBlocked(true);
      setError(e.code === 'billing_not_configured' ? PAYMENT_NOT_READY_MESSAGE : (e.message || 'Top-up could not start'));
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error('Could not copy');
    }
  };

  const shareLink = async () => {
    if (!referral?.code) return;
    try {
      const outcome = await shareReferralLink({ code: referral.code, url: link });
      if (outcome === 'shared') toast.success('Share sheet opened');
      else if (outcome === 'copied') toast.success('Referral link copied');
    } catch {
      toast.error('Could not share');
    }
  };

  const deliverReceipt = async (invoiceId) => {
    if (!window.confirm('Send this receipt again using the verified delivery details for this library?')) return;
    setDeliveringId(invoiceId);
    setError('');
    try {
      const result = await api.softwarePlanDeliverReceipt(invoiceId);
      if (result.ok === false) throw new Error(result.error || 'Receipt delivery failed');
      if (result.delivery?.status === 'sent') toast.success(result.already ? 'Receipt was already sent' : 'Receipt sent');
      else if (result.delivery?.status === 'failed') toast.error(result.delivery.reason || 'Receipt delivery failed');
      else toast(`Receipt delivery: ${result.delivery?.status || 'not confirmed'}`);
      const inv = await api.softwarePlanInvoices();
      setInvoices((inv || []).filter(row => row.kind === 'topup'));
    } catch (e) {
      setError(e.message || 'Could not deliver receipt');
    } finally {
      setDeliveringId(null);
    }
  };

  return (
    <div className="os-profile-inner">
      <div className="os-profile-top">
        <button type="button" className="os-back" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2>Wallet</h2>
      </div>

      {!canPay && (
        <div className="os-card os-card-pad os-note">Only the library owner can open the wallet.</div>
      )}
      {canPay && error && <div className="os-error" role="alert">{error}</div>}
      {canPay && loading && <div className="os-card os-card-pad os-note">Loading your wallet…</div>}

      {canPay && !loading && (
        <>
          <section className="os-card os-card-pad" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><Wallet size={16} /> Balance</div>
            <div className="os-price" style={{ margin: 0 }}>{fmt(w?.availableMinor, currency)} available</div>
            <p className="os-note">Cash {fmt(w?.cashMinor, currency)} · Bonus {fmt(w?.bonusMinor, currency)} · Held {fmt((w?.heldCashMinor || 0) + (w?.heldBonusMinor || 0), currency)}</p>
            <p className="os-note">No withdrawals or cash refunds. Wallet credit is added only after a successful, verified payment. It stays separate from subscription revenue.</p>
            {billingNotReady && <div className="os-error" role="alert">{plan?.providersConfigured === false && plan?.billingConfig?.configured !== false ? 'Top-up needs an external payment provider.' : PAYMENT_NOT_READY_MESSAGE}</div>}
            <div className="os-actions" role="group" aria-label="Top-up amount">
              {PRESETS.map(preset => (
                <button key={preset} type="button" className="btn btn-secondary btn-sm" aria-pressed={amount === preset} onClick={() => setAmount(preset)}>₹{preset}</button>
              ))}
            </div>
            <label className="os-note" htmlFor="wallet-custom-amount">Custom amount</label>
            <input id="wallet-custom-amount" className="input-field" style={{ maxWidth: 200 }} inputMode="decimal" aria-label="Custom top-up amount" value={amount} onChange={e => setAmount(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={busy || billingNotReady} onClick={askTopup}>Top up</button>
          </section>

          {confirming && (
            <section className="os-card os-card-pad" role="dialog" aria-label="Confirm top-up" style={{ display: 'grid', gap: 8 }}>
              <strong>Confirm top-up</strong>
              <p className="os-note">Add {fmt(Math.round(Number(amount) * 100), currency)} to the wallet for {libraryName}. Credit is applied only after the payment is verified. Nothing is added if payment fails or is not confirmed.</p>
              <div className="os-actions">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={startTopup}>{busy ? 'Working…' : 'Confirm and pay'}</button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </section>
          )}

          <section>
            <h3 style={{ fontSize: 15, margin: '4px 0 8px' }}>History</h3>
            {history.length === 0 ? <div className="os-card os-card-pad os-note">No wallet activity yet.</div> : (
              <div className="os-history">
                {history.map(h => (
                  <article key={h.entryId} className="os-card">
                    <div className="os-history-top">
                      <strong>{h.kind === 'credit' ? '+' : h.kind === 'debit' ? '-' : ''}{fmt(h.amountMinor, currency)}</strong>
                      <span className="os-note">{h.bucket || h.kind}</span>
                    </div>
                    <div className="os-note">{dateIST(h.createdAt)} · {h.reason || h.kind}</div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="os-card os-card-pad" style={{ display: 'grid', gap: 8 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}><Gift size={15} /> Refer & Earn</h3>
            {referralError ? <div role="alert" className="os-error">{referralError}</div> : referral ? (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Your shareable code:</span>
                  {referral.code ? <code>{referral.code}</code> : <span>Not available</span>}
                </div>
                {link && <div className="os-note" style={{ overflowWrap: 'anywhere' }}>Link: {link}</div>}
                <div className="os-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(referral.code, 'Referral code copied')}><Copy size={14} /> Copy code</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(link, 'Referral link copied')}><Copy size={14} /> Copy link</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={shareLink}><Share2 size={14} /> Share</button>
                </div>
                <div>Earned: <strong>{invoiceMoney(referral.earnedMinor, currency)}</strong> · Referrals: {referral.referrals?.length ?? '—'}</div>
                {referral.referrals?.map(ref => (
                  <div key={ref.referralId} className="os-note" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                    {dateIST(ref.createdAt)} · {ref.status} · Reward {invoiceMoney(ref.rewardMinor, currency)}
                  </div>
                ))}
                {referral.referrals?.length === 0 && <div className="os-note">No referrals yet.</div>}
              </>
            ) : <div className="os-note">Loading referrals…</div>}
          </section>

          <section>
            <h3 style={{ fontSize: 15, margin: '4px 0 8px' }}>Wallet receipts</h3>
            {receipts.length === 0 ? <div className="os-card os-card-pad os-note">No wallet receipts yet.</div> : (
              <div className="os-history">
                {receipts.map(inv => (
                  <article key={inv.invoiceId} className="os-card" style={{ display: 'grid', gap: 6 }}>
                    <div>{dateIST(inv.createdAt)} · Wallet top-up · <strong>{inv.status}</strong></div>
                    <div className="os-note">Invoice: {inv.invoiceId} · Receipt: {inv.receiptNo || '—'}</div>
                    <div className="os-note">Total {invoiceMoney(inv.totalMinor, inv.currency)} · Gateway {invoiceMoney(inv.gatewayMinor, inv.currency)}</div>
                    {inv.status === 'paid' && (
                      <div className="os-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.softwarePlanReceipt(inv.invoiceId).catch(e => setError(e.message))}><Download size={13} /> Receipt PDF</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={deliveringId !== null} onClick={() => deliverReceipt(inv.invoiceId)}>{deliveringId === inv.invoiceId ? 'Requesting…' : 'Resend receipt'}</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
