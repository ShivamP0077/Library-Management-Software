import React from 'react';
import { requiresReference } from '../utils/paymentReference';

/** Shown only when the selected mode is not cash. */
export function ReferenceField({ mode, value, onChange, error, compact = false, optional = false }) {
  if (!requiresReference(mode)) return null;
  return (
    <div className="form-group" style={compact ? { marginBottom: 0, gridColumn: '1 / -1' } : undefined}>
      <label className="form-label">Reference / UTR number{optional ? ' (optional)' : ''}</label>
      <input
        type="text"
        className="form-input"
        value={value || ''}
        maxLength={64}
        required={!optional}
        placeholder="UTR, txn id, or cheque number"
        aria-label="Reference / UTR number"
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <div style={{ color: 'red', fontSize: '11px', marginTop: '4px' }}>{error}</div> : null}
    </div>
  );
}
