import React, { useEffect, useState, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../utils/api';

/** Header bell with unread count; polls every 60s. Opens the Notifications page. */
export const NotificationBell = ({ onOpen }) => {
  const [counts, setCounts] = useState({ unread: 0, actionRequired: 0 });
  const load = useCallback(() => { api.notificationCounts().then(setCounts).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('notifications:changed', load);
    return () => { clearInterval(t); window.removeEventListener('notifications:changed', load); };
  }, [load]);
  const n = counts.unread || 0;
  return (
    <button type="button" id="notification-bell" onClick={onOpen} title="Notifications" aria-label={`Notifications${n ? ` (${n} unread)` : ''}`}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, background: 'var(--bg-secondary, #f3f4f6)', border: '1px solid var(--border-color, #e5e7eb)', cursor: 'pointer', color: 'var(--text-primary)', flexShrink: 0 }}>
      <Bell size={17} />
      {n > 0 && (
        <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: counts.actionRequired ? '#dc2626' : '#2563eb', color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center' }}>
          {n > 99 ? '99+' : n}
        </span>
      )}
    </button>
  );
};
