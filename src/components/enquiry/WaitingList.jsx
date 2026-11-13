import React, { useEffect, useState } from 'react';
import { Phone, QrCode, UserPlus } from 'lucide-react';
import { api } from '../../utils/api';
import { formatIndianMobile, normalizeIndianMobile, telHref, timeAgo } from '../../utils/enquiry';
import { refreshWaitingEnquiryCount } from './useWaitingEnquiryCount';
import { EnquiryQrCard } from './EnquiryQrCard';

/**
 * Admit opens New Admission with this enquiry's details. The enquiry stays
 * "waiting" until the admission is saved and onAdmitted marks it admitted.
 */
export function WaitingList({ onAdmit }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);

  const load = () => {
    setError('');
    api.enquiries('waiting')
      .then((data) => setItems(data.items || []))
      .catch((err) => setError(err.message || 'Could not load the waiting list.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener('libos:enquiries-changed', onChanged);
    return () => window.removeEventListener('libos:enquiries-changed', onChanged);
  }, []);

  const admit = (item) => {
    onAdmit?.({
      name: item.name,
      phone: normalizeIndianMobile(item.mobile),
      email: item.email || '',
      enquiryId: item.id,
    });
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove ${item.name} from the waiting list?`)) return;
    setError('');
    try {
      await api.updateEnquiry(item.id, 'removed');
      setItems(prev => prev.filter(row => row.id !== item.id));
      refreshWaitingEnquiryCount();
      window.dispatchEvent(new CustomEvent('libos:enquiries-changed'));
    } catch (err) {
      setError(err.message || 'Could not remove this enquiry.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>New enquiries (QR)</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>Enquiries from the QR form, newest first. They stay here until the admission is saved.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setQrOpen(true)}><QrCode size={16} /> Enquiry QR</button>
      </div>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Loading enquiries…</p>}
      {!loading && items.length === 0 && (
        <div className="premium-card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-tertiary)' }}>No one is waiting right now.</div>
      )}
      {items.map(item => (
        <article key={item.id} className="premium-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ fontSize: 16 }}>{item.name}</strong>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{timeAgo(item.createdAt)}</span>
          </div>
          <div style={{ fontSize: 14 }}>{formatIndianMobile(item.mobile)}</div>
          {item.preferred && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Preferred: {item.preferred}</div>}
          {item.message && <p style={{ margin: 0, fontSize: 14 }}>{item.message}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            <a className="btn btn-secondary btn-sm" href={telHref(item.mobile)}><Phone size={14} /> Call</a>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => admit(item)}><UserPlus size={14} /> Admit</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(item)}>Remove</button>
          </div>
        </article>
      ))}
      {qrOpen && (
        <div role="dialog" aria-modal="true" aria-label="Enquiry QR" onClick={() => setQrOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '92vh', overflow: 'auto' }}>
            <EnquiryQrCard />
            <button type="button" className="btn btn-ghost" onClick={() => setQrOpen(false)} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
