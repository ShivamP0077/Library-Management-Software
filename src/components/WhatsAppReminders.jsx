import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { api, getToken } from '../utils/api';
import { ReminderTiming } from './WhatsAppSettings';

/** Issue #17: auto-reminder rules (days before/after the due date, send time, on/off, only if unpaid). */
const HOURS = Array.from({ length: 11 }, (_, i) => 9 + i); // 9 AM .. 7 PM (quiet hours stay 9 AM–8 PM)
const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
const newId = () => Math.random().toString(36).slice(2, 8);
export const whenLabel = (d) => (d === 0 ? 'On the due date' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} before` : `${d} day${d === 1 ? '' : 's'} after`);

export const WhatsAppReminders = () => {
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!getToken()) { setRules([]); return; }
    api.reminderSettings().then(c => setRules(Array.isArray(c?.rules) ? c.rules : [])).catch(() => setRules([]));
  }, []);
  if (!getToken()) return <div className="premium-card" style={{ padding: 20, fontSize: 14, color: 'var(--text-secondary)' }}>Sign in to a cloud account to set auto reminders.</div>;
  if (!rules) return <div className="premium-card" style={{ padding: 20, fontSize: 14, color: 'var(--text-secondary)' }}>Loading reminders…</div>;

  const upd = (i, patch) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRules(rs => [...rs, { id: newId(), offsetDays: -3, sendHour: 10, enabled: true, onlyIfUnpaid: false, template: 'renewal_reminder' }]);
  const save = async () => {
    setSaving(true);
    try { const c = await api.saveReminderSettings({ rules }); setRules(c?.rules || []); toast.success('Auto reminders saved'); }
    catch (e) { toast.error(e.message || 'Could not save'); } finally { setSaving(false); }
  };
  const field = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="premium-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Reminder rules</strong>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Each rule sends one message per student for each due date. Messages only go out between 9 AM and 8 PM, never twice, and stop when the student renews.
            {rules.length ? '' : ' With no rules, the simple expiry timing below is used.'}
          </p>
        </div>
        {rules.map((r, i) => (
          <div key={r.id} className="wa-rule" style={{ border: '1px solid var(--border-light)', borderRadius: 10, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', opacity: r.enabled === false ? 0.6 : 1 }}>
            <label style={field}>When
              <select className="form-input" aria-label={`Rule ${i + 1} when`} value={Math.sign(r.offsetDays) || 0} onChange={e => { const sgn = Number(e.target.value); upd(i, { offsetDays: sgn === 0 ? 0 : sgn * (Math.abs(r.offsetDays) || 1) }); }}>
                <option value={-1}>Before due date</option><option value={0}>On due date</option><option value={1}>After due date</option>
              </select>
            </label>
            {r.offsetDays !== 0 && (
              <label style={field}>Days
                <input className="form-input" aria-label={`Rule ${i + 1} days`} type="number" min={1} max={30} value={Math.abs(r.offsetDays)} onChange={e => upd(i, { offsetDays: Math.sign(r.offsetDays) * Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} />
              </label>
            )}
            <label style={field}>Send at
              <select className="form-input" aria-label={`Rule ${i + 1} time`} value={r.sendHour ?? 9} onChange={e => upd(i, { sendHour: Number(e.target.value) })}>
                {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
            <label style={field}>Message
              <select className="form-input" aria-label={`Rule ${i + 1} message`} value={r.template || 'renewal_reminder'} onChange={e => upd(i, { template: e.target.value })}>
                <option value="renewal_reminder">Renewal reminder</option><option value="fee_reminder">Fee reminder</option>
              </select>
            </label>
            <label style={{ ...field, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!r.onlyIfUnpaid} onChange={e => upd(i, { onlyIfUnpaid: e.target.checked })} /> Only if unpaid</label>
            <label style={{ ...field, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={r.enabled !== false} onChange={e => upd(i, { enabled: e.target.checked })} /> On</label>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>{whenLabel(r.offsetDays)}, {hourLabel(r.sendHour ?? 9)}{r.onlyIfUnpaid ? ', only if a fee is pending' : ''}</span>
              <button type="button" className="btn btn-sm btn-secondary" aria-label={`Delete rule ${i + 1}`} onClick={() => setRules(rs => rs.filter((_, j) => j !== i))} style={{ minWidth: 44, minHeight: 44 }}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={add} disabled={rules.length >= 10}><Plus size={16} /> Add rule</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</button>
        </div>
      </div>
      <div className="premium-card" style={{ padding: 16 }}><ReminderTiming /></div>
    </div>
  );
};

export default WhatsAppReminders;
