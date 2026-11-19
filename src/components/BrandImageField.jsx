import React, { useState } from 'react';
import { compressImageDataUrl } from '../utils/compressImage';
import { api } from '../utils/api';
import { isAllowedBrandImageType, libraryLogoUrl } from '../utils/libraryLogo';

const MAX_HINT = 512 * 1024;

export function BrandImageField({
  label,
  value,
  onChange,
  fallbackText = '',
  help,
  documentKey,
  testId,
  emptyLabel = 'No image uploaded',
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const src = libraryLogoUrl(value);
  const inputId = testId ? `${testId}-input` : undefined;

  const apply = (next) => {
    setError('');
    onChange(next);
  };

  const onFile = async (file) => {
    if (!file) return;
    if (!isAllowedBrandImageType(file.type, file.name)) {
      setError('Please choose a PNG, JPEG, WebP or GIF image.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.readAsDataURL(file);
      });
      const out = await compressImageDataUrl(dataUrl, { fileName: file.name, purpose: 'branding' });
      const next = out?.dataUrl || dataUrl;
      if (!libraryLogoUrl(next)) {
        setError('Please choose a PNG, JPEG, WebP or GIF image.');
        return;
      }
      if (documentKey) {
        try { await api.saveDocument(documentKey, next, { fileName: file.name, fileType: file.type, fileSize: next.length }); } catch { /* settings value is the public source of truth */ }
      }
      apply(next);
    } catch (err) {
      setError(err.message || 'Could not use that image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-group" data-testid={testId} style={{ gridColumn: '1 / -1' }}>
      <label className="form-label" htmlFor={inputId}>{label}</label>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{
          width: 88, height: 88, borderRadius: 12, border: '1px solid var(--border-light)',
          background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        }}>
          {src ? (
            <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : fallbackText ? (
            <span style={{ fontSize: 32, lineHeight: 1 }} aria-hidden="true">{fallbackText}</span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', padding: 8 }}>{emptyLabel}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="form-input"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              onFile(file);
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {value && value !== fallbackText ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(fallbackText)} disabled={busy}>
                Remove
              </button>
            ) : null}
          </div>
          {help ? <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{help}</p> : null}
          {busy ? <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Compressing image…</p> : null}
          {error ? <p role="alert" style={{ margin: '6px 0 0', fontSize: 12, color: '#dc2626' }}>{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

export { MAX_HINT };
