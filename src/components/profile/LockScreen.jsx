import React, { useEffect, useState } from 'react';
import { Lock, Mail, Phone } from 'lucide-react';
import { api } from '../../utils/api';
import { SUPPORT_EMAIL } from '../../utils/support';
import './profile.css';

export function LockScreen({ message, onRenew, onContact, canRenew = true }) {
  return (
    <div className="os-lock">
      <div className="os-lock-icon" aria-hidden="true"><Lock size={32} /></div>
      <h3>Your plan has expired</h3>
      <p>{message || 'Your My Library OS plan has expired. Renew to continue.'}</p>
      <div className="os-lock-actions">
        {canRenew && <button type="button" className="btn btn-primary" onClick={onRenew}>Renew now</button>}
        <button type="button" className="btn btn-secondary" onClick={onContact}><Phone size={16} /> Contact us</button>
        <a className="btn btn-secondary" href={`mailto:${SUPPORT_EMAIL}`}><Mail size={16} /> {SUPPORT_EMAIL}</a>
      </div>
    </div>
  );
}

export function LockedDashboard({ message, onRenew, onContact, canRenew = true }) {
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancel = false;
    api.dashboardCounts()
      .then(data => { if (!cancel) setCounts(data); })
      .catch(e => { if (!cancel) setError(e.message || 'Could not load counts'); });
    return () => { cancel = true; };
  }, []);
  const items = [
    ['Students', counts?.students],
    ['Seats', counts?.seats],
    ['Payments', counts?.payments],
  ];
  return (
    <div className="os-profile-inner" style={{ maxWidth: 880 }}>
      <div className="os-banner" role="status">
        <div>{message || 'Your plan has expired. Renew to unlock your library.'}</div>
        <div className="os-lock-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
          {canRenew && <button type="button" className="btn btn-primary btn-sm" onClick={onRenew}>Renew now</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onContact}>Contact us</button>
          <a className="btn btn-secondary btn-sm" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </div>
      </div>
      {error && <div className="os-error">{error}</div>}
      <div className="os-counts">
        {items.map(([label, value]) => (
          <div key={label} className="os-count">
            <strong>{value == null ? '—' : value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="os-note">Other sections stay locked until the plan is renewed. Library Settings and My Library OS Profile remain available.</p>
    </div>
  );
}
