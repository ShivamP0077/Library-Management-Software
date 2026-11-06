import React, { useEffect, useMemo, useState } from 'react';
import { X, Wallet, Download, Copy, Gift } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

const fmt = (minor, currency = 'INR') => `${currency === 'INR' ? '₹' : ''}${(Number(minor || 0) / 100).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency === 'INR' ? '' : ` ${currency}`}`;

const dateIST = value => value ? `${new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : '—';
const invoiceMoney = (value, currency) => value == null || !currency ? '—' : fmt(value, currency);

export function MySoftwarePlanModal({ onClose }) {
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [referral, setReferral] = useState(null);
  const [referralError, setReferralError] = useState('');
  const [deliveringId, setDeliveringId] = useState(null);
  const [planId, setPlanId] = useState('');
  const [interval, setInterval] = useState('month');
  const [offerCode, setOfferCode] = useState('');
  const [useWallet, setUseWallet] = useState(true);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [topup, setTopup] = useState('1000');
  const [walletSpend, setWalletSpend] = useState(null);
  const [walletHistory, setWalletHistory] = useState([]);

  const load = async () => {
    try {
      const [r, inv, hist, refs] = await Promise.all([api.softwarePlan(), api.softwarePlanInvoices(), api.walletHistory(20).catch(() => []), api.referrals().then(value => ({ value })).catch(e => ({ error: e.message || 'Could not load referrals' }))]);
      setReferral(refs.value || null);
      setReferralError(refs.error || '');
      setData(r);
      setInvoices(inv || []);
      setWalletHistory(hist || []);
      const preferred = r.planId || r.plans?.[0]?.planId || '';
      setPlanId(prev => prev || preferred);
      setInterval(prev => prev || r.subscription?.interval || 'month');
      return { ...r, planId: preferred };
    } catch (e) { setError(e.message || 'Could not load your plan'); return null; }
  };
  useEffect(() => { load(); }, []);

  const currentPlan = useMemo(() => data?.plans?.find(p => p.planId === (data?.planId)) || null, [data]);
  const quoteNow = async (overrides = {}) => {
    if (!data || !planId) return;
    setBusy(true); setError('');
    try {
      const q = await api.softwarePlanQuote({ planId, interval, offerCode: offerCode || undefined, useWallet, walletMinor: useWallet ? (walletSpend == null ? undefined : Math.max(0, Math.round(Number(walletSpend)))) : 0, ...overrides });
      setQuote(q);
    } catch (e) { setError(e.message); setQuote(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (data && planId) quoteNow(); }, [data, planId, interval, useWallet]);

  const checkout = async () => {
    if (!quote) return;
    setBusy(true); setError('');
    try {
      const r = await api.softwarePlanCheckout({ planId, interval, offerCode: offerCode || undefined, useWallet, walletMinor: useWallet ? (walletSpend == null ? undefined : Math.max(0, Math.round(Number(walletSpend)))) : 0, returnUrl: typeof window !== 'undefined' ? `${window.location.origin}/#software_plan` : undefined });
      if (r.checkout?.url) { window.location.href = r.checkout.url; return; }
      if (r.changeType === 'downgrade') toast.success('Downgrade scheduled for your next renewal');
      else if (r.walletOnly) toast.success('Paid from wallet');
      else toast.success('Plan updated');
      setQuote(null);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const startTopup = async () => {
    setBusy(true); setError('');
    try {
      const amount = Number(topup);
      if (!(amount > 0)) throw new Error('Enter a valid top-up amount');
      const r = await api.walletTopup({ amount });
      if (r.checkout?.url) { window.location.href = r.checkout.url; return; }
      toast.success('Top-up started');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const copyCode = async () => {
    if (!referral?.code) return;
    try { await navigator.clipboard.writeText(referral?.code || ''); toast.success('Referral code copied'); }
    catch { toast.error('Could not copy'); }
  };
  const deliverReceipt = async (invoiceId) => {
    if (!window.confirm('Send this receipt again using the verified delivery details for this library?')) return;
    setDeliveringId(invoiceId); setError('');
    try {
      const result = await api.softwarePlanDeliverReceipt(invoiceId);
      if (result.ok === false) throw new Error(result.error || 'Receipt delivery failed');
      if (result.delivery) setInvoices(rows => rows.map(inv => inv.invoiceId === invoiceId ? { ...inv, receiptDelivery: result.delivery } : inv));
      if (result.delivery?.status === 'sent') toast.success(result.already ? 'Receipt was already sent' : 'Receipt sent');
      else if (result.delivery?.status === 'failed') toast.error(result.delivery.reason || 'Receipt delivery failed');
      else toast(`Receipt delivery: ${result.delivery?.status || 'not confirmed'}${result.delivery?.reason ? ` — ${result.delivery.reason}` : ''}`);
      setInvoices(await api.softwarePlanInvoices());
    } catch (e) { setError(e.message || 'Could not deliver receipt'); }
    finally { setDeliveringId(null); }
  };
  const w = data?.wallet;
  const walletMax = Math.min(Number(quote?.wallet?.availableMinor ?? w?.availableMinor ?? 0), Number(quote?.totalMinor ?? 0));
  const walletSliderValue = Math.min(Number(walletSpend == null ? (quote?.walletAppliedMinor || 0) : walletSpend), walletMax);
  const gatewayBlocked = Boolean(quote && quote.gatewayDueMinor > 0 && !data?.providersConfigured);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="My Software Plan" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="glass-panel" style={{ background: 'var(--bg-surface, #fff)', width: '100%', maxWidth: 760, maxHeight: '92vh', overflow: 'auto', padding: 20, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>My Software Plan</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Subscription, wallet, offers and referrals. Separate from Billing & General.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
        {!data ? <div style={{ fontSize: 13 }}>Loading…</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <section style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>Current plan</div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{currentPlan?.name || data.subscription?.planId || 'No plan'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{data.subscription?.status || 'not started'}{data.subscription?.currentPeriodEnd ? ` · renews ${new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}` : ''}</div>
              </section>
              <section style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}><Wallet size={12} /> Wallet balance</div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{fmt(w?.availableMinor, w?.currency)} available</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cash {fmt(w?.cashMinor, w?.currency)} · Bonus {fmt(w?.bonusMinor, w?.currency)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Held {fmt((w?.heldCashMinor || 0) + (w?.heldBonusMinor || 0), w?.currency)}</div>
                <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>No withdrawals or cash refunds. Wallet credits are only for plan payments/top-ups; bonus credits expire per policy.</div>
              </section>
              <section style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>Billing setup</div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{data.billingConfig?.configured ? 'Configured' : 'Not configured'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{data.billingConfig?.taxMode === 'none' ? 'No tax' : data.billingConfig?.taxMode ? `Tax ${data.billingConfig.taxRatePct}% (${data.billingConfig.taxMode})` : 'Super Admin must choose tax/currency'}</div>
                <div style={{ fontSize: 11, color: data.providersConfigured ? '#15803d' : '#b45309', marginTop: 4 }}>{data.providersConfigured ? 'External payment provider ready' : 'External provider unavailable — wallet-only actions remain available'}</div>
              </section>
            </div>

            <section>
              <h4 style={{ margin: '0 0 8px' }}>Change plan</h4>
              <div style={{ display: 'grid', gap: 8 }}>
                {data.plans.map(p => (
                  <label key={p.planId} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${planId === p.planId ? 'var(--brand-primary, #2563eb)' : 'var(--border-light, #e5e7eb)'}`, borderRadius: 8, padding: 10, fontSize: 13, cursor: 'pointer' }}>
                    <input type="radio" name="software-plan" checked={planId === p.planId} onChange={() => { setPlanId(p.planId); setQuote(null); }} />
                    <span><strong>{p.name}</strong> · {fmt(p.priceMonthly * 100, data.billingConfig?.currency)}/month{p.priceYearly ? ` or ${fmt(p.priceYearly * 100, data.billingConfig?.currency)}/year` : ''}{p.trialDays ? ` · ${p.trialDays}-day trial` : ''}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                {data.plans.some(p => p.priceYearly) && <label><input type="checkbox" checked={interval === 'year'} onChange={e => setInterval(e.target.checked ? 'year' : 'month')} /> Yearly</label>}
                <label><input type="checkbox" checked={useWallet} onChange={e => { setUseWallet(e.target.checked); setWalletSpend(null); }} /> Use wallet balance</label>
                <input className="input-field" style={{ maxWidth: 180 }} placeholder="Offer code" value={offerCode} onChange={e => setOfferCode(e.target.value.toUpperCase())} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => quoteNow()} disabled={busy}>Recalculate</button>
              </div>
              {useWallet && (
                <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Wallet amount to use</span><strong>{fmt(walletSliderValue, quote?.currency || w?.currency)}</strong></div>
                  <input type="range" min="0" max={Math.max(0, walletMax)} step="100" value={walletSliderValue} onChange={e => setWalletSpend(Number(e.target.value))} onPointerUp={() => quoteNow({ walletMinor: walletSliderValue })} onKeyUp={() => quoteNow({ walletMinor: walletSliderValue })} style={{ width: '100%' }} aria-label="Wallet amount to use" />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-tertiary)' }}><span>0</span><span>Max {fmt(walletMax, quote?.currency || w?.currency)}</span></div>
                </div>
              )}
              {quote && (
                <div style={{ marginTop: 10, background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, padding: 12, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Change</span><strong style={{ textTransform: 'capitalize' }}>{quote.changeType}</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Plan amount</span><span>{fmt(quote.baseMinor, quote.currency)}</span></div>
                  {quote.discountMinor > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Offer discount</span><span>-{fmt(quote.discountMinor, quote.currency)}</span></div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Taxable value</span><span>{fmt(quote.taxableMinor, quote.currency)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GST {quote.taxIncluded ? '(included in plan price)' : '(added)'}</span><span>{fmt(quote.taxMinor, quote.currency)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-light, #e5e7eb)', marginTop: 4, paddingTop: 4 }}><strong>Total</strong><strong>{fmt(quote.totalMinor, quote.currency)}</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Wallet applied</span><span>-{fmt(quote.walletAppliedMinor, quote.currency)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Pay by external gateway</span><strong>{fmt(quote.gatewayDueMinor, quote.currency)}</strong></div>
                  {!quote.ready && <div style={{ color: '#b45309', marginTop: 6 }}>Super Admin must configure tax/currency before activation.</div>}
                  {gatewayBlocked && <div style={{ color: '#b45309', marginTop: 6 }}>External payments are unavailable. Ask the Super Admin to configure Razorpay/PayPal, or use wallet credit only.</div>}
                  <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || !quote.ready || gatewayBlocked} onClick={checkout}>
                    {busy ? 'Working…' : quote.changeType === 'downgrade' ? 'Schedule downgrade' : quote.gatewayDueMinor === 0 ? 'Pay from wallet' : 'Continue to payment'}
                  </button>
                </div>
              )}
            </section>

            <section>
              <h4 style={{ margin: '0 0 8px' }}>Wallet top-up</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input-field" style={{ maxWidth: 160 }} inputMode="decimal" value={topup} onChange={e => setTopup(e.target.value)} />
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !data.providersConfigured} onClick={startTopup}>Top up</button>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Top-ups are separate from plan purchases. Bonus credits expire per the Super Admin policy; cash does not expire. No withdrawals or refunds.</span>
                {!data.providersConfigured && <span style={{ fontSize: 12, color: '#b45309' }}>Top-up needs an external payment provider.</span>}
              </div>
            </section>

            <section>
              <h4 style={{ margin: '0 0 8px' }}>Wallet history</h4>
              {walletHistory.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No wallet activity yet.</div> : (
                <div style={{ display: 'grid', gap: 4 }}>
                  {walletHistory.slice(0, 10).map(h => (
                    <div key={h.entryId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, borderBottom: '1px solid var(--border-light, #e5e7eb)', padding: '4px 0' }}>
                      <span>{new Date(h.createdAt).toLocaleDateString()} · {h.reason || h.kind} · {h.bucket || ''}</span>
                      <strong>{h.kind === 'credit' ? '+' : h.kind === 'debit' ? '-' : ''}{fmt(h.amountMinor, w?.currency)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 style={{ margin: '0 0 8px' }}><Gift size={15} /> Refer & Earn</h4>
              {referralError ? <div role="alert" style={{ fontSize: 13, color: '#b45309' }}>{referralError}</div> : referral ? (
                <div style={{ fontSize: 13, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>Your shareable code:</span>
                    {referral.code ? <><code style={{ background: 'var(--bg-secondary, #f1f5f9)', padding: '4px 8px', borderRadius: 6 }}>{referral.code}</code><button type="button" className="btn btn-ghost btn-sm" onClick={copyCode}><Copy size={14} /> Copy</button></> : <span>Not available</span>}
                  </div>
                  <div>Earned: <strong>{invoiceMoney(referral.earnedMinor, data.billingConfig?.currency)}</strong> · Referrals: {referral.referrals?.length ?? '—'}</div>
                  {referral.referrals?.map(ref => <div key={ref.referralId} style={{ borderTop: '1px solid var(--border-light, #e5e7eb)', paddingTop: 6, overflowWrap: 'anywhere' }}>
                    {dateIST(ref.createdAt)} · {ref.status} · Reward {invoiceMoney(ref.rewardMinor, data.billingConfig?.currency)}
                    {ref.qualifiedAt && <div>Qualified: {dateIST(ref.qualifiedAt)}</div>}
                    {ref.reason && <div>{ref.reason}</div>}
                  </div>)}
                  {referral.referrals?.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No referrals yet.</div>}
                </div>
              ) : <div style={{ fontSize: 13 }}>Loading referrals…</div>}
            </section>

            <section>
              <h4 style={{ margin: '0 0 8px' }}>Invoices & receipts</h4>
              {invoices.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No invoices yet.</div> : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {invoices.map(inv => (
                    <article key={inv.invoiceId} style={{ display: 'grid', gap: 6, fontSize: 13, borderBottom: '1px solid var(--border-light, #e5e7eb)', padding: '10px 0', overflowWrap: 'anywhere', minWidth: 0 }}>
                      <div>{dateIST(inv.createdAt)} · {inv.kind === 'topup' ? 'Wallet top-up' : inv.planId || 'Plan'} · <strong>{inv.status}</strong></div>
                      <div>Invoice: {inv.invoiceId} · Receipt: {inv.receiptNo || '—'}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                        {[["Base", inv.baseMinor], ["Discount", inv.discountMinor], ["Taxable value", inv.taxableMinor], [inv.taxIncluded ? 'Tax (included)' : 'Tax (added)', inv.taxMinor], ["Total", inv.totalMinor], ["Wallet", inv.walletMinor], ["Gateway", inv.gatewayMinor]].map(([label, amount]) => <div key={label}>{label}: <strong>{invoiceMoney(amount, inv.currency)}</strong></div>)}
                      </div>
                      <div>Period: {dateIST(inv.periodStart)} – {dateIST(inv.periodEnd)}{inv.interval ? ` · ${inv.interval}` : ''}</div>
                      <div>Provider: {inv.provider || '—'} · Reference: {inv.providerRef || '—'}</div>
                      {inv.failureReason && <div style={{ color: '#b45309' }}>{inv.failureReason}</div>}
                      <div>Receipt delivery: <strong>{inv.receiptDelivery?.status || 'not recorded'}</strong>{inv.receiptDelivery?.channel ? ` · ${inv.receiptDelivery.channel}` : ''}{inv.receiptDelivery?.attempts != null ? ` · ${inv.receiptDelivery.attempts} attempt(s)` : ''}</div>
                      {inv.receiptDelivery?.reason && <div>Reason: {inv.receiptDelivery.reason}</div>}
                      {inv.receiptDelivery?.status === 'logged' && <div style={{ color: '#b45309' }}>Logged only; delivery is not confirmed.</div>}
                      {inv.receiptDelivery?.sentAt && <div>Sent: {dateIST(inv.receiptDelivery.sentAt)}</div>}
                      <details>
                        <summary>Delivery history ({inv.receiptDelivery?.history?.length || 0})</summary>
                        {inv.receiptDelivery?.history?.length ? <ul style={{ paddingLeft: 20 }}>{inv.receiptDelivery.history.map((h, i) => <li key={h._id || `${h.at}-${i}`}>{dateIST(h.at)} · {h.status} · {h.channel || '—'}{h.target ? ` · ${h.target}` : ''}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul> : <div>No delivery attempts recorded.</div>}
                      </details>
                      {inv.status === 'paid' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.softwarePlanReceipt(inv.invoiceId).catch(e => setError(e.message))}><Download size={13} /> Receipt PDF</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={deliveringId !== null} onClick={() => deliverReceipt(inv.invoiceId)}>{deliveringId === inv.invoiceId ? 'Requesting…' : 'Resend receipt'}</button>
                      </div>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
