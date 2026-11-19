import React, { useEffect, useState } from 'react';
import {
  Users, ShieldCheck, ChevronDown, ChevronRight, RefreshCw, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../auth/AuthContext';
import { api } from '../utils/api';

const ROLE_LABELS = { staff: 'Staff', client_admin: 'Co-admin', superadmin: 'Super Admin' };
const roleLabel = (role) => ROLE_LABELS[role] || role || 'Staff';

const STATUS_STYLES = {
  pending: { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' },
  accepted: { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
  revoked: { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' },
  expired: { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' },
};

const readableAction = (action) => String(action || '').replace(/[._]+/g, ' ').trim();

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

export function TeamAccess() {
  const { user } = useAuth() || {};

  const canManage = user?.role === 'client_admin' || user?.role === 'superadmin';

  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState('');
  const [revokingId, setRevokingId] = useState(null);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');

  const loadInvites = async () => {
    setInvitesLoading(true);
    setInvitesError('');
    try {
      const data = await api.invites();
      setInvites(Array.isArray(data) ? data : []);
    } catch {
      setInvitesError('Unable to load invites right now.');
    } finally {
      setInvitesLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    loadInvites();
  }, [canManage]);

  useEffect(() => {
    if (!logsOpen) return;
    let cancelled = false;
    setLogsLoading(true);
    setLogsError('');
    api.auditLogs('?limit=100')
      .then(data => { if (!cancelled) setLogs(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setLogsError('Activity log is unavailable right now.'); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [logsOpen]);

  if (!canManage) return null;

  const handleRevoke = async (invite) => {
    setRevokingId(invite.id);
    try {
      await api.revokeInvite(invite.id);
      toast.success('Invite revoked.');
      await loadInvites();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="premium-card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
        <Users size={18} color="#6366f1" />
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          Team logins & invites
        </h3>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        New staff get their sign-in link from Add Staff Member. Each link works once and expires automatically.
        Money access, including Allow all financial permissions, comes from the linked staff record. Librarians never receive Wallet.
      </p>

      {/* Invites list */}
      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Invites</h4>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={loadInvites}
            disabled={invitesLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '4px 8px' }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {invitesLoading ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading invites…</p>
        ) : invitesError ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{invitesError}</p>
        ) : invites.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No invites yet.</p>
        ) : (
          <div className="table-container" style={{ width: '100%', overflowX: 'auto' }}>
            <table className="data-grid" style={{ width: '100%', minWidth: '560px' }}>
              <thead>
                <tr>
                  <th>EMAIL</th>
                  <th>ROLE</th>
                  <th>STATUS</th>
                  <th>EXPIRES</th>
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(inv => {
                  const status = inv.status || 'pending';
                  return (
                    <tr key={inv.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{inv.email}</div>
                        {inv.name && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{inv.name}</div>
                        )}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          <ShieldCheck size={12} /> {roleLabel(inv.role)}
                        </span>
                      </td>
                      <td>
                        <span style={{ ...(STATUS_STYLES[status] || STATUS_STYLES.pending), padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize' }}>
                          {status}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formatDate(inv.expiresAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {status === 'pending' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => handleRevoke(inv)}
                            disabled={revokingId === inv.id}
                            style={{ fontSize: '11px', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}
                          >
                            {revokingId === inv.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity log */}
      <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-light)', paddingTop: '14px' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setLogsOpen(open => !open)}
          aria-expanded={logsOpen}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, padding: '4px 8px' }}
        >
          {logsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Activity log
        </button>

        {logsOpen && (
          <div style={{ marginTop: '10px' }}>
            {logsLoading ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading activity…</p>
            ) : logsError ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{logsError}</p>
            ) : logs.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No activity recorded yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {logs.map(log => (
                  <div
                    key={log.id}
                    style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'baseline' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <Clock size={11} /> {formatDate(log.at)}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {log.actorEmail || 'Unknown user'}
                      {log.actorRole === 'superadmin' ? ' (Super Admin support)' : ''}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      {readableAction(log.action)}
                    </span>
                    {log.target && (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{log.target}</span>
                    )}
                    {log.reason && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', width: '100%' }}>{log.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TeamAccess;
