import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDocumentBlob } from '../../utils/idbStorage';
import { findPhotoDoc } from '../../utils/studentPhoto';
import { receiptView, money } from '../../utils/receipt';
import { useLibrary } from '../../context/LibraryContext';
import { Printer, X } from 'lucide-react';

const APP_LOGO = '/logo-icon.png';
const COPY_STORAGE_KEY = 'mlos.receiptCopyChoice';
const DEFAULT_TERMS = 'Fees once paid are non-refundable. Keep this receipt for your records.';

const COPY_CHOICES = [
  { id: 'student', label: 'Student copy' },
  { id: 'library', label: 'Library copy' },
  { id: 'both', label: 'Both' },
];

function readCopyChoice() {
  try {
    const saved = localStorage.getItem(COPY_STORAGE_KEY);
    if (saved === 'student' || saved === 'library' || saved === 'both') return saved;
  } catch { /* private mode */ }
  return 'both';
}

function slipsForChoice(choice) {
  if (choice === 'student') return ['STUDENT COPY'];
  if (choice === 'library') return ['LIBRARY COPY'];
  return ['STUDENT COPY', 'LIBRARY COPY'];
}

function waitForImages(root, timeoutMs = 3000) {
  const pending = Array.from(root.querySelectorAll('img')).filter(img => !img.complete);
  if (!pending.length) return Promise.resolve();
  return new Promise(resolve => {
    let remaining = pending.length;
    const finish = () => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(resolve, timeoutMs);
    pending.forEach(img => {
      if (img.complete) finish();
      else {
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
      }
    });
  });
}

/** A stored library mark is only used when it is an image URL. Emoji/text is not drawn as a box. */
function libraryLogoUrl(logo) {
  const value = typeof logo === 'string' ? logo.trim() : '';
  if (!value) return '';
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(value)) return value;
  if (value.startsWith('/') && /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(value)) return value;
  return '';
}

function storedWords(receipt) {
  const candidates = [receipt?.amountInWords, receipt?.amountWords, receipt?.netInWords, receipt?.netTotalInWords, receipt?.inWords];
  const found = candidates.find(w => typeof w === 'string' && w.trim());
  return found ? found.trim() : '';
}

function studentInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function ReceiptLogo({ logo }) {
  const custom = libraryLogoUrl(logo);
  const [src, setSrc] = useState(custom || APP_LOGO);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    setSrc(custom || APP_LOGO);
  }, [custom]);

  if (hidden || !src) return null;
  return (
    <img
      className="receipt-logo"
      src={src}
      alt=""
      onError={() => {
        if (src !== APP_LOGO) setSrc(APP_LOGO);
        else setHidden(true);
      }}
    />
  );
}

function StudentAvatar({ photo, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photo]);
  if (photo && !failed) {
    return <img src={photo} alt="Student photo" className="receipt-photo" onError={() => setFailed(true)} />;
  }
  return <span className="receipt-initials" aria-hidden="true">{studentInitials(name)}</span>;
}

function CutLine() {
  return (
    <div className="receipt-cut" role="separator" aria-label="Cut here">
      <span>
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <circle cx="6" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="6" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8.2 8.4 L20 18.2 M8.2 15.6 L20 5.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        Cut here
      </span>
    </div>
  );
}

const ReceiptSlip = ({ receipt, settings, branch, photo, copyLabel, view }) => {
  const v = view;
  const address = (branch?.address || settings.address || '').trim();
  const phone = (settings.phone || '').trim();
  const gst = (settings.taxId || '').trim();
  const words = storedWords(receipt);
  const refText = v.referenceLine ? v.referenceLine.replace(/^Ref:\s*/, '') : '';
  const studentName = receipt.studentName || v.studentName || '—';
  const stamp = v.state.label || 'PAID';
  const terms = (settings.receiptFooter || '').trim() || DEFAULT_TERMS;
  const contact = [phone ? `Phone: ${phone}` : '', gst ? `GST: ${gst}` : ''].filter(Boolean).join('  ·  ');
  const cells = [
    ['Receipt no', receipt.receiptNo || '—'],
    ['Paid on', v.paidOn || '—'],
    ['Period', `${v.period.start || '—'} – ${v.period.end || '—'}`],
    ['Next due', v.period.nextDue || '—'],
  ];

  return (
    <article className="printable-receipt receipt-slip">
      <header className="receipt-slip-head">
        <div className="receipt-slip-brand">
          <ReceiptLogo logo={settings.logo} />
          <div className="receipt-slip-id">
            <h2 className="receipt-lib-name">{settings.name}</h2>
            {address ? <p className="receipt-lib-meta">{address}</p> : null}
            {contact ? <p className="receipt-lib-meta">{contact}</p> : null}
          </div>
        </div>
        <div className="receipt-slip-aside">
          <span className={`receipt-stamp${stamp.length > 8 ? ' is-long' : ''}`}>{stamp}</span>
          <span className="receipt-copy-label">{copyLabel}</span>
        </div>
      </header>

      <div className="receipt-info-grid">
        {cells.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="receipt-student">
        <StudentAvatar photo={photo} name={studentName} />
        <div className="receipt-student-main">
          <strong className="receipt-student-name">{studentName}</strong>
          <div className="receipt-student-meta">
            <span><em>ID</em> {receipt.studentId || '—'}</span>
            <span><em>Seat</em> {receipt.seatNo || receipt.seatName || 'Non-Fixed / Not Assigned'}</span>
            <span><em>Plan</em> {receipt.planName || '—'}</span>
          </div>
        </div>
      </div>

      <div className="receipt-pay">
        <div className="receipt-pay-mode">
          <span className="receipt-k">Payment mode</span>
          {receipt.method === 'Split' && receipt.breakdown ? (
            <div>
              <strong>SPLIT</strong>
              {receipt.breakdown.map((b, i) => (
                <div key={i} className="receipt-split">
                  {b.method}: ₹{b.amount}{b.referenceNo ? ` · Ref: ${b.referenceNo}` : ''}
                </div>
              ))}
            </div>
          ) : (
            <strong>{receipt.method || '—'}</strong>
          )}
        </div>
        {refText && receipt.method !== 'Split' ? (
          <div className="receipt-pay-ref">
            <span className="receipt-k">Ref / UTR</span>
            <strong>{refText}</strong>
          </div>
        ) : null}
      </div>

      <div className="receipt-table-wrap">
        <table className="receipt-items">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Subscription Base Fee</td>
              <td className="num">₹{receipt.amount || receipt.netTotal}</td>
            </tr>
            {receipt.discount > 0 && (
              <tr>
                <td>Concession / Discount</td>
                <td className="num">- ₹{receipt.discount}</td>
              </tr>
            )}
            {receipt.fine > 0 && (
              <tr>
                <td>Late Fine / Reg Charge</td>
                <td className="num">+ ₹{receipt.fine}</td>
              </tr>
            )}
            <tr className="receipt-net">
              <td>{v.state.settled ? 'Net total paid' : 'Net total'}</td>
              <td className="num">{money(v.amounts.netTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {words ? (
        <p className="receipt-words"><span>Amount in words</span> {words}</p>
      ) : null}

      <footer className="receipt-slip-foot">
        <p className="receipt-terms">{terms}</p>
        <p className="receipt-powered">Powered by My Library OS</p>
      </footer>
    </article>
  );
};

function ReceiptStack({ slips, receipt, settings, branch, photo, view }) {
  return slips.map((label, index) => (
    <React.Fragment key={label}>
      {index > 0 ? <CutLine /> : null}
      <section className={`receipt-half ${index === 0 ? 'receipt-half-top' : 'receipt-half-bottom'}`}>
        <ReceiptSlip
          receipt={receipt}
          settings={settings}
          branch={branch}
          photo={photo}
          view={view}
          copyLabel={label}
        />
      </section>
    </React.Fragment>
  ));
}

export const PrintReceiptModal = ({ receipt, onClose }) => {
  const { settings, branches, students } = useLibrary();
  const [photo, setPhoto] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoPendingRef = useRef(false);
  const [copyChoice, setCopyChoice] = useState(readCopyChoice);

  useEffect(() => {
    try { localStorage.setItem(COPY_STORAGE_KEY, copyChoice); } catch { /* ignore */ }
  }, [copyChoice]);

  // Photo, if the student has one (issue #12).
  useEffect(() => {
    let alive = true;
    let objUrl = null;
    setPhoto(null);
    const st = receipt && (students || []).find(s => s.id === receipt.studentId || s.studentId === receipt.studentId);
    const doc = findPhotoDoc(st);
    if (!doc) {
      photoPendingRef.current = false;
      setPhotoLoading(false);
      return () => { alive = false; };
    }
    photoPendingRef.current = true;
    setPhotoLoading(true);
    const uiTimer = setTimeout(() => { if (alive) setPhotoLoading(false); }, 3000);
    getDocumentBlob(doc.storageKey, { studentId: st?.id }).then(d => {
      if (!alive || !d) return;
      if (typeof d === 'string') setPhoto(d);
      else { objUrl = URL.createObjectURL(d); setPhoto(objUrl); }
    }).catch(() => {}).finally(() => {
      if (!alive) return;
      photoPendingRef.current = false;
      setPhotoLoading(false);
      clearTimeout(uiTimer);
    });
    return () => {
      alive = false;
      photoPendingRef.current = false;
      clearTimeout(uiTimer);
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [receipt, students]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && receipt) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [receipt, onClose]);

  if (!receipt) return null;

  const branch = branches.find(b => b.id === receipt.branchId) || (receipt.branchName ? { name: receipt.branchName, code: receipt.branchCode || 'BR' } : branches[0]);
  const receiptStudent = (students || []).find(s => s.id === receipt.studentId || s.studentId === receipt.studentId);
  const view = receiptView(receipt, { student: receiptStudent, branch, settings });
  const slips = slipsForChoice(copyChoice);
  const slipProps = { slips, receipt, settings, branch, photo, view };

  const handlePrint = async () => {
    const photoDeadline = Date.now() + 3000;
    while (photoPendingRef.current && Date.now() < photoDeadline) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sheet = document.querySelector('.receipt-print-sheet');
    if (sheet) await waitForImages(sheet, 3000);
    window.print();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content receipt-modal" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            <Printer size={20} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Receipt Preview</h3>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={handlePrint} disabled={photoLoading}>
              <Printer size={16} />
              <span>{photoLoading ? 'Loading photo…' : 'Print'}</span>
            </button>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={onClose} title="Close">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="modal-body receipt-modal-body">
          <div className="receipt-preview">
            <ReceiptStack {...slipProps} />
          </div>
        </div>

        {createPortal(
          <div className="receipt-print-sheet" aria-hidden="true">
            <div className="receipt-a4">
              <ReceiptStack {...slipProps} />
            </div>
          </div>,
          document.body
        )}

        <div className="modal-footer no-print receipt-modal-footer">
          <div className="receipt-seg" role="radiogroup" aria-label="Which copy to print">
            {COPY_CHOICES.map(choice => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={copyChoice === choice.id}
                className={copyChoice === choice.id ? 'is-selected' : undefined}
                onClick={() => setCopyChoice(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <div className="receipt-modal-actions">
            <button className="btn btn-secondary" onClick={onClose}>Close Preview</button>
            <button className="btn btn-primary" onClick={handlePrint} disabled={photoLoading}>
              <Printer size={16} />
              <span>{photoLoading ? 'Loading photo…' : 'Print Receipt'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
