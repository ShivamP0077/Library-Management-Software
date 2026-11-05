import React from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Trash2 } from 'lucide-react';
import { useBackClose } from '../utils/useBackClose';

// Issue #3: full-screen preview of a picked or captured file, with Retake and Remove.
export const DocPreview = ({ src, name, fileType, onClose, onRemove, onRetake }) => {
  useBackClose(true, onClose);
  const isPdf = (fileType || '').includes('pdf') || (src || '').startsWith('data:application/pdf');
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Document preview" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(2,6,23,0.92)', display: 'flex', flexDirection: 'column' }}>
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 8px 8px 16px', color: '#fff' }}>
        <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'Preview'}</span>
        <button type="button" onClick={onClose} aria-label="Close preview" style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer' }}><X size={20} /></button>
      </div>
      <div onClick={e => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        {!src ? <span style={{ color: '#cbd5e1' }}>Preview not available</span>
          : isPdf ? <embed src={src} type="application/pdf" style={{ width: '100%', height: '100%', background: '#fff' }} />
          : <img src={src} alt={name || 'Preview'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
      </div>
      {(onRetake || onRemove) && (
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '12px 12px calc(12px + env(safe-area-inset-bottom))' }}>
          {onRetake && <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onRetake}><RotateCcw size={16} /> Retake</button>}
          {onRemove && <button type="button" className="btn btn-secondary" style={{ minHeight: 44, color: 'var(--status-error, #dc2626)' }} onClick={onRemove}><Trash2 size={16} /> Remove</button>}
        </div>
      )}
    </div>, document.body);
};
