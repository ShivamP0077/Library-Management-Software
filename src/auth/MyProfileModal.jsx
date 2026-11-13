import React, { useEffect, useMemo, useState } from 'react';
import { X, Download, RefreshCw, ShieldCheck, Mail, Smartphone, CheckCircle2, Link2Off, Printer, Share2, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import { ChangePasswordModal } from './ChangePasswordModal';

const field = { display: 'grid', gap: 4, fontSize: 13 };
const box = { border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 10, padding: 14 };
const row = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ReauthFields({ data, auth, setAuth }) {
  if (!data?.permissions?.sensitiveLibraryReauth && !data?.owner) return null;
  const hasPassword = Boolean(data?.user?.hasPassword);
  return (
    <div style={{ ...box, background: 'var(--bg-secondary, #f8fafc)', padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Confirm it is you</div>
      {hasPassword ? (
        <label style={field}>Current password
          <input className="input-field" type="password" autoComplete="current-password" value={auth.currentPassword} onChange={e => setAuth({ ...auth, currentPassword: e.target.value, reauthToken: '' })} placeholder="Required for login email/mobile or library contact changes" />
        </label>
      ) : null}
      <div style={{ ...row, marginTop: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={auth.busy} onClick={() => auth.startOtp('email')}><Mail size={13} /> Send code to verified email</button>
        {data?.user?.mobileVerified && <button type="button" className="btn btn-ghost btn-sm" disabled={auth.busy} onClick={() => auth.startOtp('mobile')}><Smartphone size={13} /> Send SMS</button>}
      </div>
      {auth.otpSent && !auth.reauthToken && (
        <div style={{ ...row, marginTop: 8 }}>
          <input className="input-field" style={{ maxWidth: 140 }} inputMode="numeric" maxLength={6} placeholder="Security code" value={auth.reauthCode} onChange={e => setAuth({ ...auth, reauthCode: e.target.value.replace(/\D/g, '') })} />
          <button type="button" className="btn btn-secondary btn-sm" disabled={auth.busy || auth.reauthCode.length !== 6} onClick={() => auth.completeOtp()}>Verify</button>
        </div>
      )}
      {auth.reauthToken && <div style={{ color: '#15803d', fontSize: 12, marginTop: 6 }}><CheckCircle2 size={13} /> Security check verified. Save your change within 10 minutes.</div>}
    </div>
  );
}

export function MyProfileModal({ onClose }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState({ name: '', libraryName: '', city: '', address: '', phone: '', contactEmail: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const [contact, setContact] = useState(null);
  const [authState, setAuthState] = useState({ currentPassword: '', reauthCode: '', reauthToken: '', otpSent: false, busy: false });

  const apply = (r) => {
    setData(r);
    setForm({
      name: r.ownerDetails?.name || r.user?.name || '',
      libraryName: r.libraryDetails?.name || '',
      city: r.libraryDetails?.city || '',
      address: r.libraryDetails?.address || '',
      phone: r.libraryDetails?.phone || '',
      contactEmail: r.libraryDetails?.contactEmail || '',
    });
  };
  const load = async () => {
    setError('');
    try {
      const [r, h] = await Promise.all([api.profile(), api.registrationConfirmationHistory().catch(() => null)]);
      apply(r); setHistory(h);
    } catch (e) { setError(e.message || 'Could not load your profile'); }
  };
  useEffect(() => { load(); }, []);

  const auth = useMemo(() => ({
    ...authState,
    startOtp: async (via) => {
      setAuthState(s => ({ ...s, busy: true, reauthToken: '', reauthCode: '' })); setError('');
      try {
        await api.reauthStart(via);
        setAuthState(s => ({ ...s, busy: false, otpSent: true }));
        toast.success(`Security code sent to your verified ${via}`);
      } catch (e) { setAuthState(s => ({ ...s, busy: false })); setError(e.message); }
    },
    completeOtp: async () => {
      setAuthState(s => ({ ...s, busy: true })); setError('');
      try {
        const r = await api.reauthComplete(authState.reauthCode);
        setAuthState(s => ({ ...s, busy: false, reauthToken: r.reauthToken }));
        toast.success('Security check complete');
      } catch (e) { setAuthState(s => ({ ...s, busy: false })); setError(e.message); }
    },
  }), [authState]);
  const authPayload = () => authState.reauthToken ? { reauthToken: authState.reauthToken } : { currentPassword: authState.currentPassword };
  const resetAuth = () => setAuthState({ currentPassword: '', reauthCode: '', reauthToken: '', otpSent: false, busy: false });

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const sensitive = form.phone !== (data?.libraryDetails?.phone || '') || form.contactEmail !== (data?.libraryDetails?.contactEmail || '');
    try {
      const r = await api.updateProfile({
        name: form.name,
        ...(data?.permissions?.canEditLibrary ? {
          library: { name: form.libraryName, city: form.city, address: form.address, phone: form.phone, contactEmail: form.contactEmail },
          ...(sensitive ? authPayload() : {}),
        } : {}),
      });
      apply(r); resetAuth(); toast.success('Profile saved');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const startContact = async () => {
    if (!contact) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api.contactStart({ channel: contact.channel, value: contact.value, ...authPayload() });
      setContact(c => ({ ...c, stage: 'verify', sentTo: r.sentTo }));
      setNotice(`Verification code sent to ${r.sentTo}.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const verifyContact = async () => {
    if (!contact) return;
    setBusy(true); setError('');
    try {
      const r = await api.contactVerify({ channel: contact.channel, value: contact.value, code: contact.code });
      apply(r); setContact(null); resetAuth(); toast.success('Contact verified');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const unlink = async (channel) => {
    if (!window.confirm(`Unlink this ${channel}? You must keep another verified login method.`)) return;
    setBusy(true); setError('');
    try {
      const r = await api.contactUnlink({ channel, ...authPayload() });
      apply(r); resetAuth(); toast.success('Contact unlinked');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const retry = async () => {
    setBusy(true); setError('');
    try {
      const c = await api.retryRegistrationConfirmation();
      setData(d => ({ ...d, registrationConfirmation: c }));
      setHistory(await api.registrationConfirmationHistory().catch(() => history));
      toast.success('Confirmation delivery retried');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const confirmation = data?.registrationConfirmation;
  const confirmationText = () => confirmation ? [
    `Registration confirmation ${confirmation.confirmationNumber}`,
    `${confirmation.libraryName} (${confirmation.libraryId})`,
    `Owner: ${confirmation.ownerName || ''}`,
    `Plan: ${confirmation.planName || 'No plan'}${confirmation.interval ? ` (${confirmation.interval})` : ''}`,
    `Account status: ${confirmation.paymentStatus}`,
    'This confirms registration only. It is not a payment receipt.',
  ].join('\n') : '';
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'My Library OS registration confirmation', text: confirmationText() });
      else await navigator.clipboard.writeText(confirmationText());
      toast.success(navigator.share ? 'Shared' : 'Confirmation copied');
    } catch { /* user cancelled */ }
  };
  const print = () => {
    if (!confirmation) return;
    const w = window.open('', '_blank');
    if (!w) return setError('Allow pop-ups to print the confirmation');
    w.document.write(`<!doctype html><title>${escapeHtml(confirmation.confirmationNumber)}</title><h2>My Library OS — Registration Confirmation</h2><p><b>${escapeHtml(confirmation.confirmationNumber)}</b></p><p>${escapeHtml(confirmation.libraryName)} (${escapeHtml(confirmation.libraryId)})</p><p>Owner: ${escapeHtml(confirmation.ownerName || '')}</p><p>Plan: ${escapeHtml(confirmation.planName || 'No plan')} ${escapeHtml(confirmation.interval || '')}</p><p>Account status: ${escapeHtml(confirmation.paymentStatus)}</p><p><b>This confirms registration only. It is not a payment receipt.</b></p>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="My Profile" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="glass-panel" style={{ background: 'var(--bg-surface, #fff)', width: '100%', maxWidth: 760, maxHeight: '92vh', overflow: 'auto', padding: 20, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>My Profile</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Owner login details, library contact details and your registration confirmation.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
        {notice && <div role="status" style={{ color: '#15803d', fontSize: 13 }}>{notice}</div>}
        {!data ? <div style={{ fontSize: 13 }}>Loading…</div> : (
          <>
            <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
              <section style={box}>
                <h4 style={{ margin: '0 0 10px' }}>Owner profile</h4>
                <label style={field}>Your name
                  <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <div style={field}><span>Login email</span>
                    <div style={{ ...row, justifyContent: 'space-between', border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: '8px 10px' }}>
                      <span>{data.ownerDetails?.email || <em>Not linked</em>} {data.ownerDetails?.emailVerified && <CheckCircle2 size={14} color="#15803d" />}</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContact({ channel: 'email', value: '', code: '', stage: 'enter' })}>Edit</button>
                    </div>
                  </div>
                  <div style={field}><span>Login mobile</span>
                    <div style={{ ...row, justifyContent: 'space-between', border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: '8px 10px' }}>
                      <span>{data.ownerDetails?.mobile || <em>Not linked</em>} {data.ownerDetails?.mobileVerified && <CheckCircle2 size={14} color="#15803d" />}</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContact({ channel: 'mobile', value: '', code: '', stage: 'enter' })}>Edit</button>
                    </div>
                  </div>
                </div>
                <div style={{ ...row, marginTop: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPwOpen(true)}><ShieldCheck size={14} /> {data.user?.hasPassword ? 'Change password' : 'Set password'}</button>
                  {data.ownerDetails?.email && <button type="button" className="btn btn-ghost btn-sm" onClick={() => unlink('email')}><Link2Off size={13} /> Unlink email</button>}
                  {data.ownerDetails?.mobile && <button type="button" className="btn btn-ghost btn-sm" onClick={() => unlink('mobile')}><Link2Off size={13} /> Unlink mobile</button>}
                </div>
              </section>

              <section style={box}>
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <h4 style={{ margin: 0 }}>Library details</h4>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{data.permissions?.canEditLibrary ? 'Owner-only fields' : data.permissions?.readOnly ? 'Read-only access' : 'Library owner only'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <label style={field}>Library name
                    <input className="input-field" value={form.libraryName} disabled={!data.permissions?.canEditLibrary} onChange={e => setForm({ ...form, libraryName: e.target.value })} />
                  </label>
                  <label style={field}>City
                    <input className="input-field" value={form.city} disabled={!data.permissions?.canEditLibrary} onChange={e => setForm({ ...form, city: e.target.value })} />
                  </label>
                </div>
                <label style={{ ...field, marginTop: 10 }}>Address
                  <input className="input-field" value={form.address} disabled={!data.permissions?.canEditLibrary} onChange={e => setForm({ ...form, address: e.target.value })} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <label style={field}>Library contact mobile
                    <input className="input-field" value={form.phone} disabled={!data.permissions?.canEditLibrary} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Public contact number" />
                  </label>
                  <label style={field}>Library contact email
                    <input className="input-field" value={form.contactEmail} disabled={!data.permissions?.canEditLibrary} onChange={e => setForm({ ...form, contactEmail: e.target.value })} placeholder="Public contact email" />
                  </label>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>These are public library contact details, separate from your verified login email/mobile. Changing them requires your current password or a security code.</p>
                {data.permissions?.canEditLibrary && ((form.phone !== (data.libraryDetails?.phone || '')) || (form.contactEmail !== (data.libraryDetails?.contactEmail || ''))) && (
                  <div style={{ marginTop: 10 }}><ReauthFields data={data} auth={auth} setAuth={setAuthState} /></div>
                )}
              </section>

              <div style={row}>
                <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setPwOpen(true)}><ShieldCheck size={14} /> {data.user?.hasPassword ? 'Change password' : 'Set password'}</button>
              </div>
            </form>

            {contact && (
              <section style={{ ...box, borderColor: 'var(--brand-primary, #2563eb)' }}>
                <h4 style={{ margin: '0 0 8px' }}>Verify new {contact.channel}</h4>
                {contact.stage === 'enter' ? (
                  <>
                    <label style={field}>New {contact.channel}
                      <input className="input-field" type={contact.channel === 'email' ? 'email' : 'tel'} value={contact.value} onChange={e => setContact({ ...contact, value: e.target.value })} placeholder={contact.channel === 'email' ? 'name@example.com' : '10-digit mobile'} />
                    </label>
                    <div style={{ marginTop: 10 }}><ReauthFields data={data} auth={auth} setAuth={setAuthState} /></div>
                    <div style={{ ...row, marginTop: 10 }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy || !contact.value} onClick={startContact}>Send verification code</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setContact(null); resetAuth(); }}>Cancel</button>
                    </div>
                    {contact.channel === 'mobile' && !data.services?.mobileVerification && <p style={{ color: '#b45309', fontSize: 12 }}>Mobile verification is not configured. No email fallback will be used.</p>}
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13, margin: '0 0 8px' }}>Enter the code sent to <strong>{contact.sentTo}</strong>. It is bound to this account and this new value.</p>
                    <input className="input-field" style={{ maxWidth: 160 }} inputMode="numeric" maxLength={6} value={contact.code} onChange={e => setContact({ ...contact, code: e.target.value.replace(/\D/g, '') })} placeholder="6-digit code" />
                    <div style={{ ...row, marginTop: 10 }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy || contact.code.length !== 6} onClick={verifyContact}>Verify and save</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContact(null)}>Cancel</button>
                    </div>
                  </>
                )}
              </section>
            )}

            <section style={box}>
              <h4 style={{ margin: '0 0 6px' }}>Registration confirmation</h4>
              {confirmation ? (
                <>
                  <div style={{ fontSize: 13, display: 'grid', gap: 3 }}>
                    <div><strong>{confirmation.confirmationNumber}</strong></div>
                    <div style={{ color: 'var(--text-secondary)' }}>{confirmation.libraryName} · {confirmation.planName || 'No plan'}{confirmation.interval ? ` (${confirmation.interval})` : ''}</div>
                    <div>Account: <strong>{confirmation.paymentStatus}</strong> · Delivery: {confirmation.delivery?.status || 'pending'}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>This confirms registration only. It is not a payment receipt.</div>
                  </div>
                  <div style={{ ...row, marginTop: 10 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => api.downloadRegistrationConfirmation('pdf').catch(e => setError(e.message))}><Download size={14} /> PDF</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.downloadRegistrationConfirmation('txt').catch(e => setError(e.message))}><Download size={14} /> Text</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={print}><Printer size={14} /> Print</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={share}><Share2 size={14} /> Share</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={retry}><RefreshCw size={14} /> Retry delivery</button>
                  </div>
                  {history && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <div style={{ ...row, fontWeight: 700 }}><History size={13} /> Delivery attempts ({history.delivery?.attempts || 0})</div>
                      {(history.delivery?.history || []).length === 0 ? <div>No delivery attempts recorded.</div> : (history.delivery.history || []).slice(-5).reverse().map((h, i) => (
                        <div key={i}>{h.at ? new Date(h.at).toLocaleString() : ''} · {h.channel || 'delivery'} · {h.status || h.reason || 'attempt'}</div>
                      ))}
                    </div>
                  )}
                </>
              ) : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Not available yet.</div>}
            </section>
          </>
        )}
      </div>
      {pwOpen && <ChangePasswordModal onClose={() => { setPwOpen(false); load(); }} hasPassword={Boolean(data?.user?.hasPassword)} />}
    </div>
  );
}
