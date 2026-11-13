import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useBackClose } from '../utils/useBackClose';

/** Same overlay / panel as the owner app's New Student modal. Closes on Esc, backdrop, or X. */
export function SaModal({ open, title, onClose, children, maxWidth = 640 }) {
  useBackClose(!!open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={() => onClose?.()} role="presentation">
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth, display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button type="button" className="btn-ghost" onClick={() => onClose?.()} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
