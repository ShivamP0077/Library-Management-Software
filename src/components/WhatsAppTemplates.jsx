import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, getToken } from '../utils/api';
import { fillTemplate } from '../utils/whatsappStatus';
import { SEND_TYPES, VARS } from './WhatsAppSendModal';
import { useLibrary } from '../context/LibraryContext';

/** Issue #17: edit the library's message templates, with variables and a live preview. */
const EDITABLE = SEND_TYPES.filter(t => t.id !== 'custom');
const HINT = {
  fee_reminder: 'Used for fee reminders (manual and automatic).',
  renewal_reminder: 'Used for renewal reminders and automatic expiry reminders.',
  fee_receipt: 'Used when you send a fee receipt by hand.',
  seat_info: 'Used when you send seat / shift details.',
};
const SAMPLE = { name: 'Asha', amount: '1,500', month: 'Nov 2026', dueDate: '2026-11-30', seat: 'A-12', shift: 'Morning', receiptNo: 'R-1001' };

export const WhatsAppTemplates = () => {
  const { settings } = useLibrary() || {};
  const [saved, setSaved] = useState(null);
  const [type, setType] = useState(EDITABLE[0].id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const def = (id) => EDITABLE.find(t => t.id === id).text;

  useEffect(() => {
    if (!getToken()) { setSaved({}); return; }
    api.whatsappTemplates().then(t => setSaved(t || {})).catch(() => setSaved({}));
  }, []);
  useEffect(() => { if (saved) setText(saved[type] || def(type)); }, [type, saved]);

  if (!getToken()) return <div className="premium-card" style={{ padding: 20, fontSize: 14, color: 'var(--text-secondary)' }}>Sign in to a cloud account to edit templates.</div>;
  if (!saved) return <div className="premium-card" style={{ padding: 20, fontSize: 14, color: 'var(--text-secondary)' }}>Loading templates…</div>;

  const custom = Boolean(saved[type]);
  const changed = text !== (saved[type] || def(type));
  const save = async (value) => {
    setBusy(true);
    try {
      const out = await api.saveWhatsappTemplates({ [type]: value });
      setSaved(out || {});
      toast.success(value === null ? 'Template reset to default' : 'Template saved');
    } catch (e) { toast.error(e.message || 'Could not save template'); } finally { setBusy(false); }
  };
  const preview = fillTemplate(text, { ...SAMPLE, library: settings?.name || 'Your Library' });

  return (
    <div className="premium-card wa-templates" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="tablist" aria-label="Template type">
        {EDITABLE.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={type === t.id} className={`btn btn-sm ${type === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setType(t.id)}>
            {t.label}{saved[t.id] ? ' •' : ''}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{HINT[type]} {custom ? 'You changed this template.' : 'Using the default text.'}</p>
      <textarea className="form-input" aria-label="Template text" rows={6} maxLength={1000} value={text} onChange={e => setText(e.target.value)} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      <div className="wa-vars" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {VARS.map(v => <button key={v} type="button" className="btn btn-sm btn-secondary" onClick={() => setText(t => `${t}${t.endsWith(' ') || !t ? '' : ' '}${v}`)}>{v}</button>)}
      </div>
      <div>
        <strong style={{ fontSize: 13 }}>Preview</strong>
        <div className="wa-preview" aria-label="Template preview"><div className="wa-bubble" style={{ whiteSpace: 'pre-wrap' }}>{preview || ' '}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={busy || !text.trim() || !changed} onClick={() => save(text)}>{busy ? 'Saving…' : 'Save template'}</button>
        {custom && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(null)}>Reset to default</button>}
      </div>
    </div>
  );
};

export default WhatsAppTemplates;
