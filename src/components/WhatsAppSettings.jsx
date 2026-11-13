import React, { useCallback, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getToken } from '../utils/api';
import { refreshWhatsappStatus } from '../utils/whatsappStatus';
import { WhatsAppLinkPanel } from './WhatsAppLinkPanel';

const DEFAULT_TOGGLES = {
  enabled: true,
  otp: false,
  receipts: true,
  feeReminders: false,
  expiryReminders: false
};

const Toggle = ({ checked, disabled, label, hint, onChange }) => (
  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '12px 0', borderTop: '1px solid var(--border-light)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
    <span style={{ fontSize: '14px', fontWeight: 500, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>
      {label}
      {hint ? <span style={{ display: 'block', fontSize: '12px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>{hint}</span> : null}
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

const WhatsAppSettingsInner = () => {
  const [toggles, setToggles] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [linkOk, setLinkOk] = useState(false);
  const fetchStatus = useCallback(() => api.whatsappStatus(), []);
  const connectWhatsapp = useCallback(() => api.whatsappConnect(), []);
  const disconnectWhatsapp = useCallback(() => api.whatsappLogout(), []);
  const onConnected = useCallback(() => refreshWhatsappStatus(), []);
  const onDisconnected = useCallback(() => refreshWhatsappStatus(), []);
  const onStatus = useCallback((data) => {
    setLinkOk(true);
    setToggles(prev => ({ ...DEFAULT_TOGGLES, ...(prev || {}), ...(data?.settings || {}) }));
  }, []);

  const handleToggle = async (key, value) => {
    if (!toggles || savingSettings) return;
    const previous = toggles;
    const next = { ...toggles, [key]: value };
    if (key === 'paymentReceipts') { next.paymentReceiptsEffective = value; next.receipts = value; }
    if (key === 'receipts' && typeof toggles.paymentReceipts !== 'boolean') next.paymentReceiptsEffective = value;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <WhatsAppLinkPanel
        fetchStatus={fetchStatus}
        connect={connectWhatsapp}
        disconnect={disconnectWhatsapp}
        onStatus={onStatus}
        onConnected={onConnected}
        onDisconnected={onDisconnected}
      />

      {linkOk && toggles && (
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
            label="Payment receipts"
            hint="After an admission payment or a renewal payment, send the student their payment receipt on WhatsApp."
            checked={typeof toggles.paymentReceipts === 'boolean' ? toggles.paymentReceipts : (typeof toggles.paymentReceiptsEffective === 'boolean' ? toggles.paymentReceiptsEffective : Boolean(toggles.receipts))}
            disabled={!toggles.enabled || savingSettings}
            onChange={(value) => handleToggle('paymentReceipts', value)}
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
