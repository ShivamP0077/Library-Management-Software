// Issue #19: owner's "My Subscription". No payment provider yet: paid changes explain that.
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const lim = (n) => (n ? n.toLocaleString() : 'Unlimited');
const STATUS = { active: 'Active', trialing: 'Free trial', pending_payment: 'Awaiting payment', expired: 'Expired', cancelled: 'Cancelled', past_due: 'Payment failed' };

export function MySubscriptionModal({ libraryName, onClose }) {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [interval, setInterval] = useState('month');
  const [del, setDel] = useState(null);
  const load = () => api.subscription().then(setV).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);
  const act = async (fn, ok) => { setBusy(true); try { setV(await fn()); if (ok) toast.success(ok); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const s = v?.subscription;
  const pending = s?.pendingPlanId && v.plans.find(p => p.planId === s.pendingPlanId);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="My subscription" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="glass-panel" style={{ background: 'var(--bg-surface, #fff)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 20, color: 'var(--text-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>My subscription</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {!v ? <p>Loading…</p> : (
          <>
            <section style={{ fontSize: 14, marginBottom: 16 }}>
              <div><strong>{v.plan?.name || 'No plan assigned'}</strong>{s && <> · {STATUS[s.status] || s.status}{s.price ? ` · ₹${Number(s.price).toLocaleString()}/${s.interval === 'year' ? 'year' : 'month'}` : ''}</>}</div>
              {s?.trialEndsAt && s.status === 'trialing' && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Trial ends {fmt(s.trialEndsAt)}</div>}
              {s?.currentPeriodEnd && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {fmt(s.currentPeriodEnd)}</div>}
              {pending && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Changes to {pending.name} on {fmt(s.currentPeriodEnd)}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10, fontSize: 12 }}>
                {[['Students', 'students', 'studentLimit'], ['Staff', 'staff', 'staffLimit'], ['Branches', 'branches', 'branchLimit']].map(([label, u, l]) => (
                  <div key={u} style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: 8 }}>
                    <div style={{ color: 'var(--text-tertiary)' }}>{label}</div><strong>{v.usage[u]}</strong> / {lim(v.limits[l])}
                  </div>
                ))}
              </div>
              {s && <button className="btn btn-ghost btn-sm" disabled={busy} style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => act(() => api.subscriptionCancel(s.cancelAtPeriodEnd), s.cancelAtPeriodEnd ? 'Subscription resumed' : 'Will cancel at period end')}>{s.cancelAtPeriodEnd ? 'Resume subscription' : 'Cancel at end of period'}</button>}
            </section>

            {v.plans.length > 0 && (
              <section style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Change plan</h4>
                  <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={interval === 'year'} onChange={e => setInterval(e.target.checked ? 'year' : 'month')} /> Yearly</label>
                </div>
                {!v.paymentsEnabled && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 8px' }}>Online payments aren't set up yet, so paid upgrades go through support for now.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {v.plans.map(p => {
                    const price = interval === 'year' ? p.priceYearly : p.priceMonthly;
                    const current = v.plan?.planId === p.planId && (s?.interval || 'month') === interval;
                    return (
                      <div key={p.planId} data-plan={p.planId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: 10, fontSize: 13 }}>
                        <div><strong>{p.name}</strong> · {price == null ? 'monthly only' : price ? `₹${price.toLocaleString()}/${interval}` : 'Free'}
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Students {lim(p.studentLimit)} · Staff {lim(p.staffLimit)} · Branches {lim(p.branchLimit)}</div></div>
                        {current ? <span className="badge badge-active">Current</span>
                          : <button className="btn btn-secondary btn-sm" disabled={busy || price == null} onClick={() => act(() => api.subscriptionChange(p.planId, interval), 'Plan updated')}>Choose</button>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Invoices</h4>
              {v.invoices.length ? null : <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0 }}>No invoices yet.</p>}
            </section>

            <section style={{ borderTop: '1px solid var(--border-light, #e5e7eb)', paddingTop: 12 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 14, color: '#b91c1c' }}>Delete library</h4>
              {v.deletionRequest ? (
                <p style={{ fontSize: 13, margin: 0 }}>Deletion requested on {fmt(v.deletionRequest.at)}. Our team will contact you before anything is deleted.{' '}
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.subscriptionWithdrawDeletion(), 'Request withdrawn')}>Withdraw request</button></p>
              ) : del ? (
                <form onSubmit={e => { e.preventDefault(); act(() => api.subscriptionRequestDeletion(del.name, del.reason), 'Deletion request sent').then(() => setDel(null)); }}>
                  <label className="form-label" htmlFor="del-name">Type <strong>{libraryName}</strong> to confirm</label>
                  <input id="del-name" className="form-input" value={del.name} onChange={e => setDel({ ...del, name: e.target.value })} />
                  <label className="form-label" htmlFor="del-reason" style={{ marginTop: 8 }}>Reason (optional)</label>
                  <input id="del-reason" className="form-input" value={del.reason} onChange={e => setDel({ ...del, reason: e.target.value })} />
                  <button className="btn btn-danger btn-sm" type="submit" disabled={busy || del.name.trim() !== libraryName} style={{ marginTop: 8, background: '#dc2626', color: '#fff' }}>Send deletion request</button>
                </form>
              ) : (
                <><p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 6px' }}>This sends a request to our team. Nothing is deleted until they confirm with you.</p>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626', paddingLeft: 0 }} onClick={() => setDel({ name: '', reason: '' })}>Request deletion…</button></>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
