import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageCircle, QrCode, LogOut, RefreshCw, CheckCircle2, Smartphone
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getToken } from '../utils/api';
import { refreshWhatsappStatus } from '../utils/whatsappStatus';
import { friendlyWhatsappError, isWakingError } from '../utils/whatsappErrors';

const AUTO_RETRY_MAX = 3;
const AUTO_RETRY_MS = 15000;

const DEFAULT_TOGGLES = {
  enabled: true,
  otp: false,
  receipts: true,
  feeReminders: false,
  expiryReminders: false
};

const QR_TTL_MS = 3 * 60 * 1000; // stop offering a QR after 3 minutes
const QR_REFRESH_MS = 40 * 1000; // request a fresh QR every 40 seconds
const STATUS_POLL_MS = 3 * 1000;

const Toggle = ({ checked, disabled, label, onChange }) => (
  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '12px 0', borderTop: '1px solid var(--border-light)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
    <span style={{ fontSize: '14px', fontWeight: 500, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>
      {label}
    </span>
    <span style={{ position: 'relative', width: '44px', height: '24px', flexShrink: 0 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          opacity: 0,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '999px',
          background: checked ? '#22c55e' : '#d1d5db',
          opacity: disabled ? 0.5 : 1,
          transition: 'background 0.2s ease'
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '3px',
          left: checked ? '23px' : '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          transition: 'left 0.2s ease'
        }}
      />
    </span>
  </label>
);

const StatusBadge = ({ state }) => {
  if (state === 'connected') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 700 }}>
        <CheckCircle2 size={14} /> Connected
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 600 }}>
        <RefreshCw size={14} /> Connecting…
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 600 }}>
      Not connected
    </span>
  );
};

const WhatsAppSettingsInner = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qr, setQr] = useState(null);
  const [pairingCode, setPairingCode] = useState(null);
  const [qrDeadline, setQrDeadline] = useState(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [toggles, setToggles] = useState(null);
  const [busy, setBusy] = useState(null); // 'connect' | 'refresh' | 'logout'
  const [savingSettings, setSavingSettings] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [waking, setWaking] = useState(false);
  const autoRetries = useRef(0);
  const retryTimer = useRef(null);

  // Initial status load (also used by the Retry button).
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await api.whatsappStatus();
        if (!active) return;
        setStatus(data);
        setToggles({ ...DEFAULT_TOGGLES, ...(data?.settings || {}) });
        if (data?.state === 'connected') {
          setQr(null);
          setPairingCode(null);
          setQrDeadline(null);
          setQrExpired(false);
        } else if (data?.state === 'connecting') {
          setQrDeadline(Date.now() + QR_TTL_MS);
          setQrExpired(false);
        }
      } catch (err) {
        if (!active) return;
        // Issue #18: while the WhatsApp service is waking up (429/503), retry by itself a few times.
        if (isWakingError(err) && autoRetries.current < AUTO_RETRY_MAX) {
          autoRetries.current += 1;
          setWaking(true);
          retryTimer.current = setTimeout(() => setReloadKey(k => k + 1), AUTO_RETRY_MS);
          return;
        }
        setWaking(false);
        setError(err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; clearTimeout(retryTimer.current); };
  }, [reloadKey]);

  // Poll the connection state while the user is scanning a QR code (paused in hidden tabs).
  useEffect(() => {
    if (status?.state !== 'connecting' || qrExpired) return;
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const data = await api.whatsappStatus();
        if (cancelled) return;
        setStatus(prev => ({ ...(prev || {}), ...data }));
        if (data?.settings) setToggles(prev => ({ ...(prev || DEFAULT_TOGGLES), ...data.settings }));
        if (data?.state === 'connected') {
          setQr(null);
          setPairingCode(null);
          setQrDeadline(null);
          setQrExpired(false);
          toast.success('WhatsApp connected.'); refreshWhatsappStatus();
        }
      } catch {
        // Transient polling errors are ignored; the next tick retries.
      }
    };
    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status?.state, qrExpired]);

  // Mark the QR as expired after 3 minutes.
  useEffect(() => {
    if (!qrDeadline || status?.state !== 'connecting') return;
    const check = () => { if (Date.now() >= qrDeadline) setQrExpired(true); };
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [qrDeadline, status?.state]);

  const requestQr = useCallback(async ({ refresh = false, extend = true } = {}) => {
    setBusy(refresh ? 'refresh' : 'connect');
    try {
      const data = await api.whatsappConnect();
      if (data?.state === 'connected') {
        setStatus(prev => ({ ...(prev || {}), ...data, state: 'connected' }));
        setQr(null);
        setPairingCode(null);
        setQrDeadline(null);
        setQrExpired(false);
        toast.success('WhatsApp connected.'); refreshWhatsappStatus();
        return;
      }
      setStatus(prev => ({ ...(prev || {}), ...data, state: 'connecting' }));
      setQr(data?.qr || null);
      setPairingCode(data?.pairingCode || null);
      // Automatic refreshes keep the original 3-minute connection window; a
      // manual refresh or a new connection starts a fresh window. The server's
      // explicit expiry wins when it sends one.
      const serverExpiry = data?.qrExpiresAt ? Date.parse(data.qrExpiresAt) : NaN;
      if (Number.isFinite(serverExpiry)) setQrDeadline(serverExpiry);
      else if (extend) setQrDeadline(Date.now() + QR_TTL_MS);
      else setQrDeadline(prev => prev || Date.now() + QR_TTL_MS);
      if (extend) setQrExpired(false);
    } catch (err) {
      toast.error(friendlyWhatsappError(err, 'Could not connect to WhatsApp.'));
    } finally {
      setBusy(null);
    }
  }, []);

  // Refresh the QR code automatically every 40 seconds while connecting (paused in hidden tabs).
  useEffect(() => {
    if (status?.state !== 'connecting' || qrExpired) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      requestQr({ refresh: true, extend: false });
    }, QR_REFRESH_MS);
    return () => clearInterval(interval);
  }, [status?.state, qrExpired, requestQr]);

  const handleLogout = async () => {
    if (!window.confirm('Log out of WhatsApp? Receipts and reminders will stop being sent until you reconnect.')) return;
    setBusy('logout');
    try {
      await api.whatsappLogout();
      setStatus(prev => ({ ...(prev || {}), state: 'disconnected', number: null, profileName: null }));
      setQr(null);
      setPairingCode(null);
      setQrDeadline(null);
      setQrExpired(false);
      toast.success('WhatsApp disconnected.'); refreshWhatsappStatus();
    } catch (err) {
      toast.error(err?.message || 'Could not log out of WhatsApp.');
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (key, value) => {
    if (!toggles || savingSettings) return;
    const previous = toggles;
    const next = { ...toggles, [key]: value };
    setToggles(next);
    setSavingSettings(true);
    try {
      const saved = await api.whatsappSaveSettings(next);
      if (saved) setToggles(prev => ({ ...(prev || previous), ...saved }));
      toast.success('Message preferences saved.');
    } catch (err) {
      setToggles(previous);
      toast.error(err?.message || 'Could not save message preferences.');
    } finally {
      setSavingSettings(false);
    }
  };

  const state = status?.state;
  const meta = status || {};

  const renderBody = () => {
    if (loading || waking) {
      if (waking && !loading) return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '20px 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
          <Smartphone size={18} /> WhatsApp service is waking up. Trying again…
        </div>
      );
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '20px 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
          <Smartphone size={18} /> Loading WhatsApp status…
        </div>
      );
    }

    if (error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
          <p style={{ fontSize: '14px', color: '#b91c1c', margin: 0 }}>
            {friendlyWhatsappError(error, 'Could not load WhatsApp status.')}
          </p>
          {error.status === 503 && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              WhatsApp is not configured on the server yet, or the service is waking up. Try again in a moment.
            </p>
          )}
          <div>
            <button type="button" className="btn btn-primary" onClick={() => { autoRetries.current = 0; setReloadKey(k => k + 1); }}>
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        </div>
      );
    }

    if (state === 'connected') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
              <Smartphone size={16} /> {meta.number || 'Connected number'}
            </div>
            {meta.profileName && (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{meta.profileName}</span>
            )}
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            This library's WhatsApp is linked. Receipts and reminders can now be delivered to students.
          </p>
          <div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === 'logout'}
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <LogOut size={15} /> {busy === 'logout' ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </div>
      );
    }

    if (state === 'connecting') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              {qrExpired ? (
                <div style={{ width: '100%', maxWidth: '260px', aspectRatio: '1 / 1', background: '#ffffff', border: '1px dashed var(--border-strong)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px', textAlign: 'center' }}>
                  <QrCode size={32} color="var(--text-muted)" />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>QR expired</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Generate a new code to continue.</span>
                </div>
              ) : qr ? (
                <div style={{ width: '100%', maxWidth: '260px', aspectRatio: '1 / 1', background: '#ffffff', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px' }}>
                  <img
                    src={qr}
                    alt="WhatsApp QR code"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#ffffff' }}
                  />
                </div>
              ) : (
                <div style={{ width: '100%', maxWidth: '260px', aspectRatio: '1 / 1', background: '#ffffff', border: '1px dashed var(--border-strong)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px', textAlign: 'center' }}>
                  <QrCode size={32} color="var(--text-muted)" />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Waiting for the QR code…</span>
                </div>
              )}

              {qrExpired ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === 'refresh' || busy === 'connect'}
                  onClick={() => requestQr({ refresh: true })}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <RefreshCw size={15} /> Generate new QR
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy === 'refresh' || busy === 'connect'}
                  onClick={() => requestQr({ refresh: true })}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <RefreshCw size={15} /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh QR'}
                </button>
              )}

              {pairingCode && (
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Or use pairing code: <strong style={{ color: 'var(--text-primary)' }}>{pairingCode}</strong>
                </span>
              )}
            </div>

            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px 0' }}>
                How to link this device
              </h4>
              <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <li>Open WhatsApp on the library's phone</li>
                <li>Tap <strong style={{ color: 'var(--text-primary)' }}>Linked devices</strong></li>
                <li>Tap <strong style={{ color: 'var(--text-primary)' }}>Link a device</strong></li>
                <li>Scan this QR code</li>
              </ol>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0 0' }}>
                The QR refreshes automatically. Keep this page open while linking.
              </p>
            </div>
          </div>
        </div>
      );
    }

    // disconnected or not_created
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <Smartphone size={20} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
            Scan a QR code with the library's WhatsApp to send receipts and reminders.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy === 'connect'}
            onClick={() => requestQr()}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <MessageCircle size={15} /> {busy === 'connect' ? 'Connecting…' : 'Connect WhatsApp'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="premium-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageCircle size={20} color="#16a34a" />
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                WhatsApp Integration
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Link the library's WhatsApp to send receipts and reminders.
              </p>
            </div>
          </div>
          {!loading && !error && <StatusBadge state={state} />}
        </div>

        {renderBody()}
      </div>

      {!loading && !error && toggles && (
        <div className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageCircle size={18} color="#16a34a" />
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Message preferences
              </h3>
            </div>
            {savingSettings && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Saving…</span>
            )}
          </div>

          <Toggle
            label="Send WhatsApp messages"
            checked={Boolean(toggles.enabled)}
            disabled={savingSettings}
            onChange={(value) => handleToggle('enabled', value)}
          />
          <Toggle
            label="Admission & renewal receipts"
            checked={Boolean(toggles.receipts)}
            disabled={!toggles.enabled || savingSettings}
            onChange={(value) => handleToggle('receipts', value)}
          />
          <Toggle
            label="Fee reminders"
            checked={Boolean(toggles.feeReminders)}
            disabled={!toggles.enabled || savingSettings}
            onChange={(value) => handleToggle('feeReminders', value)}
          />
          <Toggle
            label="Expiry reminders"
            checked={Boolean(toggles.expiryReminders)}
            disabled={!toggles.enabled || savingSettings}
            onChange={(value) => handleToggle('expiryReminders', value)}
          />
          <Toggle
            label="Admission number OTP verification"
            checked={Boolean(toggles.otp)}
            disabled={!toggles.enabled || savingSettings}
            onChange={(value) => handleToggle('otp', value)}
          />

          {(toggles.feeReminders || toggles.expiryReminders) && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Reminder timing is under <strong>Auto reminders</strong>.</p>}

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0 0' }}>
            Messages are sent only to students who have not opted out, and are prefixed with your library name.
          </p>
        </div>
      )}
    </div>
  );
};


/** Reminder timing (spec §6): when expiry & fee reminders go out, plus recent reminder log. */
export const ReminderTiming = () => {
  const [cfg, setCfg] = React.useState(null);
  const [log, setLog] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    api.reminderSettings().then(setCfg).catch(() => setCfg(null));
    api.reminders('?limit=20').then(setLog).catch(() => {});
  }, []);
  if (!cfg) return null;
  const set = (k) => (e) => setCfg(c => ({ ...c, [k]: e.target.value === '' ? null : Number(e.target.value) }));
  const save = async () => {
    setSaving(true);
    try { const { rules: _r, ...timing } = cfg; setCfg(await api.saveReminderSettings(timing)); toast.success('Reminder timing saved'); }
    catch (e) { toast.error(e.message || 'Could not save'); } finally { setSaving(false); }
  };
  const field = { display: 'grid', gap: 4, fontSize: 13, color: 'var(--text-secondary)', minWidth: 0 };
  return (
    <div id="reminder-timing" style={{ display: 'grid', gap: 10 }}>
      <strong style={{ fontSize: 14 }}>{cfg.rules?.length ? 'Fee repeat timing' : 'Reminder timing'}</strong>
      {cfg.rules?.length > 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Your reminder rules above replace the expiry timing here. Fee repeats still use these settings.</p>}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <label style={field}>Expiry: days before end<input className="form-input" type="number" min={0} max={30} value={cfg.expiryDaysBefore ?? ''} onChange={set('expiryDaysBefore')} /></label>
        <label style={field}>Or fixed day of month (1–28)<input className="form-input" type="number" min={1} max={28} placeholder="Off" value={cfg.expiryFixedDay ?? ''} onChange={set('expiryFixedDay')} /></label>
        <label style={field}>Fee: repeat every (days)<input className="form-input" type="number" min={1} max={30} value={cfg.feeEveryDays ?? ''} onChange={set('feeEveryDays')} /></label>
        <label style={field}>Fee: max reminders<input className="form-input" type="number" min={1} max={10} value={cfg.feeMaxReminders ?? ''} onChange={set('feeMaxReminders')} /></label>
      </div>
      <div><button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save timing'}</button></div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Reminders go out between 9 AM and 8 PM. Fee reminders stop as soon as the due is cleared; an expiry reminder is cancelled when the student renews.</p>
      {log.length > 0 && (
        <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <strong style={{ fontSize: 13 }}>Recent reminders</strong>
          {log.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: 'var(--text-secondary)' }}>
              <span>{r.sendOn}</span><span>{r.type === 'fee_reminder' ? 'Fee' : 'Expiry'}{r.ruleId ? ' (rule)' : ''}</span><span>student {r.studentId}</span>
              <span style={{ fontWeight: 600 }}>{r.status}{r.reason ? ` (${r.reason})` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const WhatsAppSettings = ({ canManage }) => {
  if (!canManage) {
    return (
      <div className="premium-card" style={{ padding: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <MessageCircle size={20} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>WhatsApp</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            You don't have permission to manage WhatsApp.
          </p>
        </div>
      </div>
    );
  }
  // WhatsApp runs through the cloud backend, so it needs a signed-in session.
  // In Local Offline Mode there is no token and every call would fail with 401.
  if (!getToken()) {
    return (
      <div className="premium-card" style={{ padding: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <MessageCircle size={20} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>WhatsApp</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            WhatsApp needs a cloud account. Tap "Connect / Sign In" at the top and sign in to connect your WhatsApp number.
          </p>
        </div>
      </div>
    );
  }
  return <WhatsAppSettingsInner />;
};
