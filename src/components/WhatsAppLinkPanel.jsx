import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, QrCode, LogOut, RefreshCw, CheckCircle2, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { friendlyWhatsappError, isWakingError } from '../utils/whatsappErrors';

const AUTO_RETRY_MAX = 3;
const AUTO_RETRY_MS = 15000;
const QR_TTL_MS = 3 * 60 * 1000;
const QR_REFRESH_MS = 40 * 1000;
const STATUS_POLL_MS = 3 * 1000;

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

/**
 * QR connect / status / disconnect card shared by a library WhatsApp page and the system sender.
 * `fetchStatus`, `connect` and `disconnect` return the same shape as the library WhatsApp API.
 */
export function WhatsAppLinkPanel({
  fetchStatus,
  connect,
  disconnect,
  title = 'WhatsApp Integration',
  subtitle = "Link the library's WhatsApp to send receipts and reminders.",
  connectedHint = "This library's WhatsApp is linked. Receipts and reminders can now be delivered to students.",
  disconnectedHint = "Scan a QR code with the library's WhatsApp to send receipts and reminders.",
  connectLabel = 'Connect WhatsApp',
  disconnectLabel = 'Logout',
  disconnectConfirm = 'Log out of WhatsApp? Receipts and reminders will stop being sent until you reconnect.',
  stepsTitle = 'How to link this device',
  steps = [
    "Open WhatsApp on the library's phone",
    'Tap Linked devices',
    'Tap Link a device',
    'Scan this QR code',
  ],
  onStatus,
  onConnected,
  onDisconnected,
}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qr, setQr] = useState(null);
  const [pairingCode, setPairingCode] = useState(null);
  const [qrDeadline, setQrDeadline] = useState(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [busy, setBusy] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [waking, setWaking] = useState(false);
  const autoRetries = useRef(0);
  const retryTimer = useRef(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await fetchStatus();
        if (!active) return;
        setStatus(data);
        onStatusRef.current?.(data);
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
  }, [reloadKey, fetchStatus]);

  useEffect(() => {
    if (status?.state !== 'connecting' || qrExpired) return;
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const data = await fetchStatus();
        if (cancelled) return;
        setStatus(prev => ({ ...(prev || {}), ...data }));
        onStatusRef.current?.(data);
        if (data?.state === 'connected') {
          setQr(null);
          setPairingCode(null);
          setQrDeadline(null);
          setQrExpired(false);
          toast.success('WhatsApp connected.');
          onConnected?.();
        }
      } catch {
        // Transient polling errors are ignored; the next tick retries.
      }
    };
    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status?.state, qrExpired, fetchStatus, onConnected]);

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
      const data = await connect();
      if (data?.state === 'connected') {
        setStatus(prev => ({ ...(prev || {}), ...data, state: 'connected' }));
        setQr(null);
        setPairingCode(null);
        setQrDeadline(null);
        setQrExpired(false);
        toast.success('WhatsApp connected.');
        onConnected?.();
        return;
      }
      setStatus(prev => ({ ...(prev || {}), ...data, state: 'connecting' }));
      setQr(data?.qr || null);
      setPairingCode(data?.pairingCode || null);
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
  }, [connect, onConnected]);

  useEffect(() => {
    if (status?.state !== 'connecting' || qrExpired) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      requestQr({ refresh: true, extend: false });
    }, QR_REFRESH_MS);
    return () => clearInterval(interval);
  }, [status?.state, qrExpired, requestQr]);

  const handleDisconnect = async () => {
    if (!window.confirm(disconnectConfirm)) return;
    setBusy('logout');
    try {
      await disconnect();
      setStatus(prev => ({ ...(prev || {}), state: 'disconnected', number: null, profileName: null }));
      setQr(null);
      setPairingCode(null);
      setQrDeadline(null);
      setQrExpired(false);
      toast.success('WhatsApp disconnected.');
      onDisconnected?.();
    } catch (err) {
      toast.error(err?.message || 'Could not disconnect WhatsApp.');
    } finally {
      setBusy(null);
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
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>{connectedHint}</p>
          <div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === 'logout'}
              onClick={handleDisconnect}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <LogOut size={15} /> {busy === 'logout' ? (disconnectLabel === 'Logout' ? 'Logging out…' : 'Disconnecting…') : disconnectLabel}
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
                  <img src={qr} alt="WhatsApp QR code" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#ffffff' }} />
                </div>
              ) : (
                <div style={{ width: '100%', maxWidth: '260px', aspectRatio: '1 / 1', background: '#ffffff', border: '1px dashed var(--border-strong)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px', textAlign: 'center' }}>
                  <QrCode size={32} color="var(--text-muted)" />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Waiting for the QR code…</span>
                </div>
              )}
              {qrExpired ? (
                <button type="button" className="btn btn-primary" disabled={busy === 'refresh' || busy === 'connect'} onClick={() => requestQr({ refresh: true })} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RefreshCw size={15} /> Generate new QR
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={busy === 'refresh' || busy === 'connect'} onClick={() => requestQr({ refresh: true })} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px 0' }}>{stepsTitle}</h4>
              <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {steps.map(step => <li key={step}>{step.includes('Linked') || step.includes('Link a') ? step.split(/(Linked devices|Link a device)/).map((part, i) => (part === 'Linked devices' || part === 'Link a device' ? <strong key={i} style={{ color: 'var(--text-primary)' }}>{part}</strong> : part)) : step}</li>)}
              </ol>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0 0' }}>
                The QR refreshes automatically. Keep this page open while linking.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <Smartphone size={20} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>{disconnectedHint}</p>
        </div>
        <div>
          <button type="button" className="btn btn-primary" disabled={busy === 'connect'} onClick={() => requestQr()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageCircle size={15} /> {busy === 'connect' ? 'Connecting…' : connectLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="premium-card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageCircle size={20} color="#16a34a" />
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>{subtitle}</p>
          </div>
        </div>
        {!loading && !error && <StatusBadge state={state} />}
      </div>
      {renderBody()}
    </div>
  );
}
