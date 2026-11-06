// Issue #19: Super Admin payment-provider configuration (Razorpay first, PayPal option).
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

const empty = {
  activeProvider: 'none',
  razorpay: { enabled: false, keyId: '', keySecret: '', webhookSecret: '', mode: 'test' },
  paypal: { enabled: false, clientId: '', clientSecret: '', webhookId: '', mode: 'sandbox' },
};

export function PaymentsAdmin() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [requests, setRequests] = useState([]);
  const [billing, setBilling] = useState(null);
  const [offers, setOffers] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [offerForm, setOfferForm] = useState({ name: '', code: '', discountType: 'percentage', discountValue: 10, perTenantLimit: 1, usageLimit: '', planIds: '', startsAt: '', endsAt: '', stackable: false });
  const [campaignForm, setCampaignForm] = useState({ name: '', rewardMinor: 0, rewardBucket: 'bonus' });

  const load = async () => {
    try {
      const [c, d, b, o, rc] = await Promise.all([
        api.adminPaymentsConfig(),
        api.adminDeletionRequests().catch(() => []),
        api.adminBillingConfig().catch(() => null),
        api.adminOffers().catch(() => []),
        api.adminReferralCampaigns().catch(() => []),
        api.adminList('/software-plan/invoices').catch(() => []),
      ]);
      setCfg(c);
      setBilling(b);
      setOffers(o || []);
      setCampaigns(rc || []);
      setInvoices(Array.isArray(inv) ? inv : (inv?.list || []));
      setForm({
        activeProvider: c.activeProvider || 'none',
        razorpay: {
          enabled: Boolean(c.razorpay?.enabled),
          keyId: c.razorpay?.keyId || '',
          keySecret: '',
          webhookSecret: '',
          mode: c.razorpay?.mode || 'test',
        },
        paypal: {
          enabled: Boolean(c.paypal?.enabled),
          clientId: c.paypal?.clientId || '',
          clientSecret: '',
          webhookId: c.paypal?.webhookId || '',
          mode: c.paypal?.mode || 'sandbox',
        },
      });
      setRequests(d || []);
    } catch (e) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        activeProvider: form.activeProvider,
        razorpay: {
          enabled: form.razorpay.enabled,
          keyId: form.razorpay.keyId,
          mode: form.razorpay.mode,
          ...(form.razorpay.keySecret ? { keySecret: form.razorpay.keySecret } : {}),
          ...(form.razorpay.webhookSecret ? { webhookSecret: form.razorpay.webhookSecret } : {}),
        },
        paypal: {
          enabled: form.paypal.enabled,
          clientId: form.paypal.clientId,
          webhookId: form.paypal.webhookId,
          mode: form.paypal.mode,
          ...(form.paypal.clientSecret ? { clientSecret: form.paypal.clientSecret } : {}),
        },
      };
      const c = await api.adminUpdatePaymentsConfig(body);
      setCfg(c);
      setTestError('');
      toast.success('Payment settings saved (not verified)');
      setForm(f => ({
        ...f,
        razorpay: { ...f.razorpay, keySecret: '', webhookSecret: '' },
        paypal: { ...f.paypal, clientSecret: '' },
      }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveBilling = async (patch) => {
    setBusy(true);
    try {
      const next = await api.adminUpdateBillingConfig({ ...billing, ...patch });
      setBilling(next);
      toast.success('Billing policy saved');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const createOffer = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.adminCreateOffer({ ...offerForm, discountValue: Math.round(Number(offerForm.discountValue) * (offerForm.discountType === 'fixed' ? 100 : 1)), code: offerForm.code.toUpperCase(), usageLimit: offerForm.usageLimit ? Number(offerForm.usageLimit) : null, planIds: String(offerForm.planIds || '').split(',').map(s => s.trim()).filter(Boolean), startsAt: offerForm.startsAt || null, endsAt: offerForm.endsAt || null });
      setOfferForm({ name: '', code: '', discountType: 'percentage', discountValue: 10, perTenantLimit: 1, usageLimit: '', planIds: '', startsAt: '', endsAt: '', stackable: false });
      setOffers(await api.adminOffers());
      toast.success('Offer created');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const createCampaign = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.adminCreateReferralCampaign({ ...campaignForm, rewardMinor: Number(campaignForm.rewardMinor) });
      setCampaignForm({ name: '', rewardMinor: 0, rewardBucket: 'bonus' });
      setCampaigns(await api.adminReferralCampaigns());
      toast.success('Referral campaign created');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setTesting(true); setTestError('');
    try {
      const r = await api.adminTestPaymentsConfig();
      setCfg(r);
      if (r.verification?.status === 'verified') toast.success(r.verification.message || 'Provider verified');
      else if (r.verification?.status === 'failed') toast.error(r.verification.message || 'Provider verification failed');
      else toast(r.verification?.message || 'Configuration stored; verification not confirmed');
    } catch (e) {
      setTestError(e.message || 'Provider test could not be completed');
      toast.error(e.message || 'Provider test could not be completed');
      // Failed probes persist metadata server-side; reload it rather than inventing a result.
      try { setCfg(await api.adminPaymentsConfig()); } catch { /* Keep last server metadata and show the request error. */ }
    } finally { setTesting(false); }
  };

  const resolve = async (libraryId, action) => {
    try {
      await api.adminResolveDeletionRequest(libraryId, action);
      toast.success(action === 'dismiss' ? 'Request dismissed' : 'Acknowledged');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!cfg) return <div style={{ padding: 16 }}>Loading payment settings…</div>;

  const verification = cfg.verification;
  const verificationLabel = verification?.status === 'verified' ? 'Verified' : verification?.status === 'failed' ? 'Failed' : 'Stored / not tested';
  // Prefer API host hint
  const hookHint = '/api/payments/webhook';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form className="premium-card" style={{ padding: 16 }} onSubmit={save}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Payment providers</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Keys are encrypted at rest. Leave a secret blank to keep the current value. Razorpay is recommended for India (INR); PayPal is available as an alternative.
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="active-provider">Active provider</label>
          <select id="active-provider" className="form-input" value={form.activeProvider} onChange={e => setForm(f => ({ ...f, activeProvider: e.target.value }))}>
            <option value="none">None (payments off)</option>
            <option value="razorpay">Razorpay</option>
            <option value="paypal">PayPal</option>
          </select>
        </div>

        <fieldset style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>Razorpay</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={form.razorpay.enabled} onChange={e => setForm(f => ({ ...f, razorpay: { ...f.razorpay, enabled: e.target.checked } }))} />
            Enable Razorpay
          </label>
          <div className="form-group"><label className="form-label">Key ID</label><input className="form-input" value={form.razorpay.keyId} onChange={e => setForm(f => ({ ...f, razorpay: { ...f.razorpay, keyId: e.target.value } }))} autoComplete="off" /></div>
          <div className="form-group"><label className="form-label">Key Secret {cfg.razorpay?.keySecretSet ? '(saved ••••••••)' : ''}</label><input className="form-input" type="password" value={form.razorpay.keySecret} onChange={e => setForm(f => ({ ...f, razorpay: { ...f.razorpay, keySecret: e.target.value } }))} placeholder={cfg.razorpay?.keySecretSet ? 'Leave blank to keep' : ''} autoComplete="new-password" /></div>
          <div className="form-group"><label className="form-label">Webhook secret {cfg.razorpay?.webhookSecretSet ? '(saved)' : ''}</label><input className="form-input" type="password" value={form.razorpay.webhookSecret} onChange={e => setForm(f => ({ ...f, razorpay: { ...f.razorpay, webhookSecret: e.target.value } }))} placeholder={cfg.razorpay?.webhookSecretSet ? 'Leave blank to keep' : ''} autoComplete="new-password" /></div>
          <div className="form-group">
            <label className="form-label">Mode</label>
            <select className="form-input" value={form.razorpay.mode} onChange={e => setForm(f => ({ ...f, razorpay: { ...f.razorpay, mode: e.target.value } }))}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>Webhook URL: <code>{hookHint}/razorpay</code></p>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>PayPal</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={form.paypal.enabled} onChange={e => setForm(f => ({ ...f, paypal: { ...f.paypal, enabled: e.target.checked } }))} />
            Enable PayPal
          </label>
          <div className="form-group"><label className="form-label">Client ID</label><input className="form-input" value={form.paypal.clientId} onChange={e => setForm(f => ({ ...f, paypal: { ...f.paypal, clientId: e.target.value } }))} autoComplete="off" /></div>
          <div className="form-group"><label className="form-label">Client Secret {cfg.paypal?.clientSecretSet ? '(saved)' : ''}</label><input className="form-input" type="password" value={form.paypal.clientSecret} onChange={e => setForm(f => ({ ...f, paypal: { ...f.paypal, clientSecret: e.target.value } }))} placeholder={cfg.paypal?.clientSecretSet ? 'Leave blank to keep' : ''} autoComplete="new-password" /></div>
          <div className="form-group"><label className="form-label">Webhook ID</label><input className="form-input" value={form.paypal.webhookId} onChange={e => setForm(f => ({ ...f, paypal: { ...f.paypal, webhookId: e.target.value } }))} autoComplete="off" /></div>
          <div className="form-group">
            <label className="form-label">Mode</label>
            <select className="form-input" value={form.paypal.mode} onChange={e => setForm(f => ({ ...f, paypal: { ...f.paypal, mode: e.target.value } }))}>
              <option value="sandbox">Sandbox</option>
              <option value="live">Live</option>
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>Webhook URL: <code>{hookHint}/paypal</code></p>
        </fieldset>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="submit" disabled={busy || testing}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-secondary" type="button" onClick={test} disabled={busy || testing}>{testing ? 'Testing saved credentials…' : 'Test saved active provider'}</button>
        </div>
        <div role="status" aria-live="polite" style={{ marginTop: 10, fontSize: 13, overflowWrap: 'anywhere' }}>
          Provider verification: <strong>{verificationLabel}</strong>
          {verification?.provider && <span> · {verification.provider}{verification.mode ? ` (${verification.mode})` : ''}</span>}
          <div>{verification?.message || 'Configuration is stored only; no provider verification result is available.'}</div>
          {verification?.at && <div>Tested: {new Date(verification.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>}
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>The test probes saved credentials, not unsaved form changes. Credential verification does not confirm webhook delivery or settlement.</div>
        </div>
        {testError && <div role="alert" style={{ color: '#b45309', fontSize: 13, marginTop: 8 }}>{testError}</div>}
        {cfg.paymentsEnabled && <p style={{ fontSize: 12, color: '#059669', margin: '8px 0 0' }}>Payments are enabled ({cfg.activeProvider}); credential verification is shown separately above.</p>}
        {!cfg.paymentsEnabled && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '8px 0 0' }}>Payments are off until an active provider has keys saved.</p>}
      </form>


      {billing && (
        <div className="premium-card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Billing policy (required before new plan activation)</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>There is no default GST rate. Choose tax treatment and the rate explicitly.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Currency
              <select className="form-input" value={billing.currency || 'INR'} onChange={e => setBilling({ ...billing, currency: e.target.value })}>
                <option value="INR">INR</option><option value="USD">USD</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Tax mode
              <select className="form-input" value={billing.taxMode || ''} onChange={e => setBilling({ ...billing, taxMode: e.target.value })}>
                <option value="">Choose…</option><option value="included">Included in price</option><option value="excluded">Added to price</option><option value="none">No tax</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Tax rate %
              <input className="form-input" inputMode="decimal" value={billing.taxRatePct ?? ''} onChange={e => setBilling({ ...billing, taxRatePct: e.target.value === '' ? null : e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Wallet max spend %
              <input className="form-input" inputMode="numeric" value={billing.walletMaxSpendPercent ?? 100} onChange={e => setBilling({ ...billing, walletMaxSpendPercent: e.target.value })} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Bonus expiry (months)
              <input className="form-input" inputMode="numeric" value={billing.bonusExpiryMonths ?? 12} onChange={e => setBilling({ ...billing, bonusExpiryMonths: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
            <label><input type="checkbox" checked={billing.bonusExpiryEnabled !== false} onChange={e => setBilling({ ...billing, bonusExpiryEnabled: e.target.checked })} /> Bonus expires</label>
            <span style={{ color: 'var(--text-tertiary)' }}>Cash never expires. Gateway fees are platform-absorbed.</span>
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => saveBilling({})}>Save billing policy</button>
          {!billing.configured && <span style={{ marginLeft: 10, fontSize: 12, color: '#b45309' }}>Not configured — new plan activation is blocked.</span>}
        </div>
      )}

      <div className="premium-card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Software billing history</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>The same saved receipts and amounts owners see. No private wallet or provider secrets are shown.</p>
        {!invoices.length ? <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No software invoices yet.</p> : invoices.map(inv => <div key={inv.invoiceId} style={{ borderTop: '1px solid var(--border-light, #e5e7eb)', padding: '9px 0', fontSize: 13, display: 'grid', gap: 4 }}>
          <strong>{inv.libraryName || inv.tenantId} · {inv.planName || inv.planId || 'Wallet top-up'} · {inv.status}</strong>
          <div>{new Date(inv.createdAt).toLocaleString()} · {inv.receiptNo || inv.invoiceId}</div>
          <div>Total ₹{(Number(inv.totalMinor || 0) / 100).toFixed(2)} {inv.currency !== 'INR' ? inv.currency : ''} · wallet {(Number(inv.walletMinor || 0) / 100).toFixed(2)} · gateway {(Number(inv.gatewayMinor || 0) / 100).toFixed(2)} · GST {(Number(inv.taxMinor || 0) / 100).toFixed(2)}</div>
          <div style={{ color: 'var(--text-secondary)' }}>{inv.provider || 'Wallet'} · {inv.paymentReceivedRef || inv.providerRef || inv.invoiceId} · delivery: {inv.receiptDelivery?.status || 'not attempted'}</div>
          {inv.receiptDelivery?.reason && <div style={{ color: '#b45309' }}>Receipt not delivered: {inv.receiptDelivery.reason}</div>}
          {inv.status === 'paid' && <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={async () => { try { if (!window.confirm('Resend this receipt to the verified delivery channel for this library?')) return; const r = await api.post(`/admin/software-plan/invoices/${encodeURIComponent(inv.invoiceId)}/receipt/deliver`, { confirm: true }); toast.success(r.delivery?.status === 'sent' ? 'Receipt sent' : 'Resend attempted; check delivery history'); await load(); } catch (e) { toast.error(e.message); } }}>Resend receipt</button>}
        </div>)}
      </div>
      <div className="premium-card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Offers</h3>
        <form onSubmit={createOffer} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Name<input className="form-input" value={offerForm.name} onChange={e => setOfferForm({ ...offerForm, name: e.target.value })} required /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Code<input className="form-input" value={offerForm.code} onChange={e => setOfferForm({ ...offerForm, code: e.target.value.toUpperCase() })} required /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Type<select className="form-input" value={offerForm.discountType} onChange={e => setOfferForm({ ...offerForm, discountType: e.target.value })}><option value="percentage">%</option><option value="fixed">₹ fixed</option></select></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Value<input className="form-input" value={offerForm.discountValue} onChange={e => setOfferForm({ ...offerForm, discountValue: e.target.value })} required /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Total uses<input className="form-input" inputMode="numeric" value={offerForm.usageLimit} onChange={e => setOfferForm({ ...offerForm, usageLimit: e.target.value })} placeholder="Unlimited" /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Per-library uses<input className="form-input" inputMode="numeric" value={offerForm.perTenantLimit} onChange={e => setOfferForm({ ...offerForm, perTenantLimit: e.target.value })} /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Plans (IDs, comma separated)<input className="form-input" value={offerForm.planIds} onChange={e => setOfferForm({ ...offerForm, planIds: e.target.value })} placeholder="All plans" /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Starts<input className="form-input" type="date" value={offerForm.startsAt} onChange={e => setOfferForm({ ...offerForm, startsAt: e.target.value })} /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Ends<input className="form-input" type="date" value={offerForm.endsAt} onChange={e => setOfferForm({ ...offerForm, endsAt: e.target.value })} /></label>
          <button className="btn btn-secondary" disabled={busy}>Create offer</button>
        </form>
        {(offers || []).map(o => <div key={o.offerId} style={{ fontSize: 13, borderTop: '1px solid var(--border-light, #e5e7eb)', padding: '8px 0' }}><div><strong>{o.code}</strong> · {o.name} · {o.discountType === 'percentage' ? `${o.discountValue}%` : `₹${(Number(o.discountValue || 0) / 100).toFixed(2)}`} · used {o.usedCount || 0}{o.usageLimit ? `/${o.usageLimit}` : ''}</div><div>{!o.active ? 'Inactive' : o.archived ? 'Archived' : 'Available'} · {o.stackable ? 'stackable' : 'single offer'}{(o.planIds || []).length ? ` · plans: ${o.planIds.join(', ')}` : ' · all plans'}</div><div>{o.startsAt ? `Starts ${new Date(o.startsAt).toLocaleDateString()} · ` : ''}{o.endsAt ? `Ends ${new Date(o.endsAt).toLocaleDateString()}` : 'No end date'}</div><div className="modal-actions" style={{ marginTop: 8 }}><button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await api.adminUpdateOffer(o.offerId, { active: !o.active }); setOffers(await api.adminOffers()); } catch (e) { toast.error(e.message); } }}>{o.active ? 'Disable' : 'Enable'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await api.adminUpdateOffer(o.offerId, { archived: !o.archived }); setOffers(await api.adminOffers()); } catch (e) { toast.error(e.message); } }}>{o.archived ? 'Unarchive' : 'Archive'}</button></div></div>)}
        {offers.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No offers yet.</div>}
        <label style={{ display: 'flex', gap: 6, marginTop: 10, fontSize: 13 }}><input type="checkbox" checked={offerForm.stackable} onChange={e => setOfferForm({ ...offerForm, stackable: e.target.checked })} /> Allow stacking with another offer where permitted</label>
      </div>

      <div className="premium-card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Referral campaign</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>Rewards qualify only after the first genuine paid subscription, including fully wallet-funded. Trials and 100% promos do not qualify unless enabled.</p>
        <form onSubmit={createCampaign} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Name<input className="form-input" value={campaignForm.name} onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })} required /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Reward minor units<input className="form-input" value={campaignForm.rewardMinor} onChange={e => setCampaignForm({ ...campaignForm, rewardMinor: e.target.value })} /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Bucket<select className="form-input" value={campaignForm.rewardBucket} onChange={e => setCampaignForm({ ...campaignForm, rewardBucket: e.target.value })}><option value="bonus">Bonus</option><option value="cash">Cash</option></select></label>
          <button className="btn btn-secondary" disabled={busy}>Create campaign</button>
        </form>
        {campaigns.map(c => <div key={c.campaignId} style={{ fontSize: 13, borderTop: '1px solid var(--border-light, #e5e7eb)', padding: '6px 0' }}>{c.name} · reward {c.rewardMinor} {c.rewardBucket} · {c.active ? 'active' : 'inactive'}</div>)}
        {campaigns.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No campaign configured.</div>}
      </div>

      <div className="premium-card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Deletion requests</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Owners can request deletion; you still delete from the library row (type the name). Acknowledge or dismiss here.
        </p>
        {requests.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No open deletion requests.</p>}
        {requests.map(r => (
          <div key={r.libraryId} style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
            <strong>{r.name}</strong> <span style={{ color: 'var(--text-tertiary)' }}>({r.libraryId})</span>
            <div>By {r.deletionRequest?.by} · {r.deletionRequest?.at ? new Date(r.deletionRequest.at).toLocaleString() : ''}</div>
            {r.deletionRequest?.reason && <div style={{ color: 'var(--text-secondary)' }}>{r.deletionRequest.reason}</div>}
            {r.deletionRequest?.acknowledgedAt && <div style={{ color: '#059669' }}>Acknowledged by {r.deletionRequest.acknowledgedBy}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolve(r.libraryId, 'acknowledge')}>Acknowledge</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => resolve(r.libraryId, 'dismiss')}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
