import React, { useRef, useState } from 'react';
import { api } from '../utils/api';
import { makeAttachmentKey, uploadAttachmentFile } from '../utils/attachmentUpload';
import {
  MAX_PAYMENT_PROOFS,
  PAYMENT_PROOF_TYPES,
  paymentProofRefs,
  paymentProofModeOf,
  PAYMENT_PROOF_REQUIRED_MESSAGE,
} from '../utils/paymentProof';

const IMAGE_TYPES = PAYMENT_PROOF_TYPES;

async function uploadProof(file) {
  const key = makeAttachmentKey('payproof');
  const meta = await uploadAttachmentFile({
    file,
    key,
    allowedTypes: IMAGE_TYPES,
    purpose: 'payment-proof',
    returnDataUrl: true,
    save: (storageKey, data, extra) => api.saveDocument(storageKey, data, {
      fileName: file.name,
      fileType: extra?.fileType,
      fileSize: extra?.fileSize,
    }),
  });
  const ref = paymentProofRefs([meta])[0];
  if (!ref) throw new Error('Only JPG, PNG, or WEBP photos can be attached as payment proof.');
  return { ref, preview: meta.dataUrl || '' };
}

/** Optional proof photos for a fee payment. Stores references, not the image bytes. */
export function PaymentProofFields({
  value = [],
  onChange,
  disabled = false,
  mode = 'OPTIONAL',
  showRequiredError = false,
}) {
  const proofMode = paymentProofModeOf({ paymentProofMode: mode });
  if (proofMode === 'OFF') return null;

  const proofs = paymentProofRefs(value);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const [previews, setPreviews] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const required = proofMode === 'REQUIRED';
  const requiredError = required && showRequiredError && proofs.length === 0;

  const addFiles = async (list) => {
    const files = [...(list || [])];
    if (!files.length || disabled) return;
    setBusy(true);
    setError('');
    const next = [...proofs];
    const shots = { ...previews };
    try {
      for (const file of files) {
        if (next.length >= MAX_PAYMENT_PROOFS) {
          setError(`You can attach up to ${MAX_PAYMENT_PROOFS} photos.`);
          break;
        }
        const { ref, preview } = await uploadProof(file);
        next.push(ref);
        if (preview) shots[ref.storageKey] = preview;
      }
      setPreviews(shots);
      onChange?.(next);
    } catch (err) {
      setError(err?.message || 'Could not attach that photo.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (storageKey) => {
    onChange?.(proofs.filter(item => item.storageKey !== storageKey));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="payment-proof-attach"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Attaching…' : 'Attach proof'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="payment-proof-camera"
          disabled={disabled || busy}
          onClick={() => cameraRef.current?.click()}
        >
          Take photo
        </button>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {required ? 'Required · JPG, PNG, or WEBP' : 'Optional · JPG, PNG, or WEBP'}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
      {proofs.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {proofs.map(item => (
            <div key={item.storageKey} data-testid="payment-proof-thumb" style={{ width: 72, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {previews[item.storageKey] ? (
                <img src={previews[item.storageKey]} alt={item.fileName} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border-light)' }} />
              ) : (
                <div style={{ width: 72, height: 72, borderRadius: 6, border: '1px solid var(--border-light)', fontSize: 10, padding: 4, overflow: 'hidden' }}>{item.fileName}</div>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(item.storageKey)} disabled={disabled || busy}>Remove</button>
            </div>
          ))}
        </div>
      )}
      {requiredError ? (
        <div data-testid="payment-proof-required-error" style={{ color: 'var(--status-error, #b91c1c)', fontSize: '12px' }}>
          {PAYMENT_PROOF_REQUIRED_MESSAGE}
        </div>
      ) : null}
      {error ? <div style={{ color: 'var(--status-error, #b91c1c)', fontSize: '12px' }}>{error}</div> : null}
    </div>
  );
}

/** Load a saved proof when the viewer opens it. List rows stay light. Owner/admin can edit. */
export function PaymentProofViewer({ proofs, canEdit = false, mode = 'OPTIONAL', onChange }) {
  const refs = paymentProofRefs(proofs);
  const [open, setOpen] = useState(null);
  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  if (!refs.length && !canEdit) return null;

  const show = async (item) => {
    setError('');
    setLoadingKey(item.storageKey);
    try {
      const data = await api.getDocument(item.storageKey);
      if (!data) throw new Error('This proof photo could not be loaded.');
      setOpen({ ...item, src: data });
    } catch (err) {
      setError(err?.message || 'This proof photo could not be loaded.');
    } finally {
      setLoadingKey('');
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6 }}>
      {refs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {refs.map(item => (
            <button
              key={item.storageKey}
              type="button"
              data-testid="payment-proof-thumb"
              className="btn btn-ghost btn-sm"
              onClick={() => show(item)}
              disabled={loadingKey === item.storageKey}
            >
              {loadingKey === item.storageKey ? 'Loading…' : (item.fileName || 'View proof')}
            </button>
          ))}
        </div>
      )}
      {canEdit ? (
        <div data-testid="payment-proof-edit" style={{ marginTop: refs.length ? 8 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Edit payment proof</div>
          <PaymentProofFields value={refs} onChange={onChange} mode={mode === 'OFF' ? 'OPTIONAL' : mode} />
        </div>
      ) : null}
      {error ? <div style={{ fontSize: 11, color: 'var(--status-error, #b91c1c)', marginTop: 4 }}>{error}</div> : null}
      {open?.src ? (
        <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={() => setOpen(null)}>
          <div className="modal-content" style={{ maxWidth: 520, padding: 16 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>{open.fileName}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <img src={open.src} alt={open.fileName} style={{ width: '100%', maxHeight: 420, objectFit: 'contain', background: '#f8fafc', borderRadius: 8 }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
