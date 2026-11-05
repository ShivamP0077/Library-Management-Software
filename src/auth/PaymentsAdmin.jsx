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
  const [requests, setRequests] = useState([]);

  const load = async () => {
    try {
      const [c, d] = await Promise.all([
        api.adminPaymentsConfig(),
        api.adminDeletionRequests().catch(() => []),
      ]);
      setCfg(c);
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
      toast.success('Payment settings saved');
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

  const test = async () => {
    try {
      const r = await api.adminTestPaymentsConfig();
      toast.success(`Active: ${r.provider} (${r.mode || 'n/a'})`);
    } catch (e) {
      toast.error(e.message);
    }
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

  const webhookBase = typeof window !== 'undefined' ? `${window.location.origin.replace(/:\d+$/, '')}` : '';
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
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-secondary" type="button" onClick={test}>Test active provider</button>
        </div>
        {cfg.paymentsEnabled && <p style={{ fontSize: 12, color: '#059669', margin: '8px 0 0' }}>Payments are enabled ({cfg.activeProvider}).</p>}
        {!cfg.paymentsEnabled && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '8px 0 0' }}>Payments are off until an active provider has keys saved.</p>}
      </form>

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
