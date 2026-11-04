import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, MessageCircle, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getToken } from '../utils/api';
import { useWhatsappStatus, isDisconnected, fillTemplate, navigateTo, refreshWhatsappStatus } from '../utils/whatsappStatus';
import { WhatsAppMessages } from './WhatsAppMessages';

export const SEND_TYPES = [
  { id: 'fee_reminder', label: 'Fee reminder', text: 'Hi {name} 👋\nThis is a reminder that your fee of ₹{amount} for {month} is due on {dueDate}.\nPlease pay at the desk or via UPI. Thank you!' },
  { id: 'fee_receipt', label: 'Fee receipt', text: 'Hi {name}, we have received ₹{amount} for {month} ✅\nSeat: {seat}\nReceipt no: {receiptNo}\nThank you!' },
  { id: 'renewal_reminder', label: 'Renewal reminder', text: 'Hi {name}, your membership ends on {dueDate}.\nRenew now to keep seat {seat}. Fee: ₹{amount}.\nReply to this message if you need help.' },
  { id: 'seat_info', label: 'Seat / shift info', text: 'Hi {name}, your seat details:\nSeat: {seat}\nShift: {shift}\nValid till: {dueDate}\nSee you at the library 📚' },
  { id: 'custom', label: 'Custom', text: 'Hi {name}, ' },
];
const VARS = ['{name}', '{amount}', '{month}', '{dueDate}', '{seat}'];

const monthName = (d) => { const x = d ? new Date(d) : new Date(); return isNaN(x) ? '' : x.toLocaleString('en-IN', { month: 'short', year: 'numeric' }); };
const money = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-IN'));
const payAmount = (p) => p?.amountPaid ?? p?.netTotal ?? p?.amount;
const sortedPayments = (s) => [...(s?.paymentHistory || [])].filter(p => p?.receiptNo).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

export function varsFor(student, payment) {
  const last = payment || sortedPayments(student)[0];
  return {
    name: String(student?.name || '').split(' ')[0] || 'there',
    amount: money(payAmount(last)),
    month: payment ? monthName(payment.date) : monthName(),
    dueDate: student?.extendedDueDate || student?.expiryDate || '',
    seat: student?.seatNo || '',
    shift: student?.shift || '',
    receiptNo: payment?.receiptNo || '',
  };
}

const Preview = ({ text }) => (
  <div className="wa-preview" aria-label="WhatsApp preview">
    <div className="wa-bubble">{text || ' '}<span className="wa-time">{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ✓✓</span></div>
  </div>
);

/** Send window for one student (from the row icon) or many (bulk: same message to each, one by one). */
export const WhatsAppSendModal = ({ students = [], onClose }) => {
  const bulk = students.length > 1;
  const student = students[0];
  const types = bulk ? SEND_TYPES.filter(t => t.id !== 'fee_receipt') : SEND_TYPES;
  const [type, setType] = useState(types[0].id);
  const payments = useMemo(() => sortedPayments(student), [student]);
  const [receiptNo, setReceiptNo] = useState(payments[0]?.receiptNo || '');
  const [text, setText] = useState(types[0].text);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null); // bulk: [{ student, ok, error }]
  const [historyKey, setHistoryKey] = useState(0);
  const wa = useWhatsappStatus();
  useEffect(() => { refreshWhatsappStatus(); }, []);

  const pickType = (id) => { setType(id); setText(SEND_TYPES.find(t => t.id === id).text); };
  const payment = type === 'fee_receipt' ? payments.find(p => p.receiptNo === receiptNo) : null;
  const preview = fillTemplate(text, varsFor(student, payment));

  const offline = !getToken();
  const blocked = offline ? 'Sign in to a cloud account to send WhatsApp messages.'
    : isDisconnected(wa) ? 'WhatsApp is disconnected. Reconnect it to send.'
    : !text.trim() ? 'Type a message first.'
    : type === 'fee_receipt' && !payment ? 'This student has no payments yet.'
    : !bulk && !student?.phone ? 'This student has no phone number.' : null;

  const sendOne = async (s, msgText) => {
    const pay = type === 'fee_receipt' ? payment : null;
    const r = await api.whatsappSendToStudent(s.id, { type, text: fillTemplate(msgText, varsFor(s, pay)), receiptNo: pay?.receiptNo });
    if (r?.status === 'sent' || r?.status === 'duplicate') return { ok: true };
    return { ok: false, error: r?.message?.error || r?.error || (r?.status === 'skipped' ? 'Not sent (WhatsApp is off or the student opted out)' : 'Could not send') };
  };

  const send = async (list = students) => {
    setSending(true);
    try {
      if (!bulk) {
        const r = await sendOne(student, text).catch(e => ({ ok: false, error: e?.message }));
        if (r.ok) toast.success('Message sent.'); else toast.error(r.error || 'Could not send.');
        setHistoryKey(k => k + 1);
        return;
      }
      const out = results ? [...results] : students.map(s => ({ student: s, ok: null }));
      for (const s of list) {
        const i = out.findIndex(x => x.student.id === s.id);
        const r = !s.phone ? { ok: false, error: 'No phone number' } : await sendOne(s, text).catch(e => ({ ok: false, error: e?.message }));
        out[i] = { student: s, ...r };
        setResults([...out]);
      }
    } finally { setSending(false); }
  };

  const failed = results?.filter(r => r.ok === false) || [];
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Send WhatsApp">
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="wa-icon-badge"><MessageCircle size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }} className="cell-truncate">{bulk ? `Send WhatsApp to ${students.length} students` : student?.name}</h3>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>{bulk ? 'The same message goes to each student, filled in with their details.' : [student?.seatNo && `Seat ${student.seatNo}`, student?.shift, student?.phone].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div className="modal-body wa-modal-body">
          {results ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              <strong style={{ fontSize: '14px' }}>{results.filter(r => r.ok).length} sent · {failed.length} failed{sending ? ' · sending…' : ''}</strong>
              {results.map(r => (
                <div key={r.student.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
                  {r.ok ? <CheckCircle2 size={16} color="#16a34a" /> : r.ok === false ? <AlertTriangle size={16} color="#dc2626" /> : <span style={{ width: 16 }}>…</span>}
                  <span className="cell-truncate" style={{ flex: 1, fontWeight: 600 }}>{r.student.name}</span>
                  {r.ok === false && <span style={{ color: '#b91c1c', fontSize: '12px' }}>{r.error}</span>}
                </div>
              ))}
              {!sending && failed.length > 0 && <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => send(failed.map(f => f.student))}><RotateCcw size={14} /> Retry failed</button></div>}
            </div>
          ) : (
            <>
              <p className="wa-lbl">Message type</p>
              <div className="wa-types">
                {types.map(t => <button key={t.id} type="button" className={type === t.id ? 'on' : ''} onClick={() => pickType(t.id)}>{t.label}</button>)}
              </div>
              {type === 'fee_receipt' && (
                <>
                  <p className="wa-lbl">Receipt for month</p>
                  {payments.length === 0 ? <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>No payments yet.</p> : (
                    <select className="form-select" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} style={{ fontSize: '16px' }}>
                      {payments.map((p, i) => <option key={p.receiptNo} value={p.receiptNo}>{i === 0 ? 'Latest' : i === 1 ? 'Previous' : 'Older'} · {monthName(p.date)} · ₹{money(payAmount(p))} · {p.receiptNo}</option>)}
                    </select>
                  )}
                </>
              )}
              <p className="wa-lbl">Message</p>
              <textarea className="form-input" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={1800} style={{ fontSize: '16px', resize: 'vertical' }} />
              <div className="wa-vars">{VARS.map(v => <button key={v} type="button" onClick={() => setText(t => `${t}${t.endsWith(' ') || !t ? '' : ' '}${v}`)}>{v}</button>)}</div>
              <p className="wa-lbl">Preview{bulk ? ` (for ${student?.name})` : ''}</p>
              <Preview text={preview} />
              {bulk && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>To: {students.map(s => s.name).join(', ')}</p>}
            </>
          )}
          {!bulk && getToken() && (
            <div style={{ marginTop: '6px' }}><WhatsAppMessages key={historyKey} studentId={student.id} compact /></div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {blocked && !results && (
            <span style={{ fontSize: '12px', color: '#b91c1c', marginRight: 'auto' }}>
              {blocked}{isDisconnected(wa) && <> <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onClose(); navigateTo('whatsapp', 'login'); }}>Reconnect</button></>}
            </span>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>{results ? 'Done' : 'Cancel'}</button>
          {!results && <button type="button" className="btn btn-primary wa-send-btn" disabled={!!blocked || sending} onClick={() => send()}><Send size={15} /> {sending ? 'Sending…' : bulk ? `Send to ${students.length}` : 'Send'}</button>}
        </div>
      </div>
    </div>,
    document.body
  );
};
export default WhatsAppSendModal;
