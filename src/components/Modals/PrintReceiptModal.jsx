import React, { useEffect } from 'react';
import { useLibrary } from '../../context/LibraryContext';
import { Printer, X } from 'lucide-react';

export const PrintReceiptModal = ({ receipt, onClose }) => {
  const { settings, branches } = useLibrary();

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

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '550px' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header toolbar */}
        <div className="modal-header no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
            <Printer size={20} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Receipt Preview</h3>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={handlePrint}>
              <Printer size={16} />
              <span>Print</span>
            </button>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={onClose} title="Close">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Printable Receipt Paper Container */}
        <div className="modal-body" style={{ background: '#ffffff', color: '#000000', borderRadius: 'var(--radius-md)', padding: '2rem' }}>
          
          <div className="printable-receipt" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* Header / Library Details */}
            <div style={{ textAlign: 'center', borderBottom: '2px dashed #333', paddingBottom: '1rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>{settings.logo}</div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#000000' }}>{settings.name}</h2>
              <div style={{ fontSize: '0.75rem', color: '#444444', marginTop: '0.25rem' }}>{branch?.address || settings.address}</div>
              <div style={{ fontSize: '0.75rem', color: '#444444' }}>Phone: {settings.phone} | GST: {settings.taxId}</div>
            </div>

            {/* Receipt Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>
              <div>
                <div><strong>RECEIPT NO:</strong> {receipt.receiptNo}</div>
                <div><strong>DATE:</strong> {receipt.date}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div><strong>BRANCH:</strong> {receipt.branchName || (branch ? branch.name : (settings.name || 'Main Branch'))}</div>
                <div><strong>STAFF:</strong> {receipt.staffName || 'Admin'}</div>
              </div>
            </div>

            {/* Student Info */}
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.8125rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.9375rem', color: '#000' }}>STUDENT: {receipt.studentName}</div>
              <div>STUDENT ID: <strong>{receipt.studentId}</strong></div>
              <div>SEAT NO: <strong>{receipt.seatNo || receipt.seatName || "Non-Fixed / Not Assigned"}</strong></div>
              <div>PLAN: {receipt.planName}</div>
              {receipt.method === 'Split' && receipt.breakdown ? (
                <div>
                  PAYMENT MODE: <strong style={{color: '#15803d'}}>SPLIT</strong>
                  {receipt.breakdown.map((b, i) => (
                    <div key={i} style={{ fontSize: '0.625rem', color: '#666', marginTop: '2px', paddingLeft: '8px' }}>
                      ↳ {b.method}: ₹{b.amount}
                    </div>
                  ))}
                </div>
              ) : (
                <div>PAYMENT MODE: <strong>{receipt.method}</strong></div>
              )}
            </div>

            {/* Itemized Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #000', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0' }}>DESCRIPTION</th>
                  <th style={{ padding: '0.5rem 0', textAlign: 'right' }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '0.5rem 0' }}>Subscription Base Fee</td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>₹{receipt.amount || receipt.netTotal}</td>
                </tr>
                {receipt.discount > 0 && (
                  <tr>
                    <td style={{ padding: '0.25rem 0', color: '#16a34a' }}>Concession / Discount</td>
                    <td style={{ padding: '0.25rem 0', textAlign: 'right', color: '#16a34a' }}>- ₹{receipt.discount}</td>
                  </tr>
                )}
                {receipt.fine > 0 && (
                  <tr>
                    <td style={{ padding: '0.25rem 0', color: '#dc2626' }}>Late Fine / Reg Charge</td>
                    <td style={{ padding: '0.25rem 0', textAlign: 'right', color: '#dc2626' }}>+ ₹{receipt.fine}</td>
                  </tr>
                )}
                <tr style={{ borderTop: '2px solid #000', fontWeight: 800, fontSize: '0.9375rem' }}>
                  <td style={{ padding: '0.75rem 0' }}>NET TOTAL PAID</td>
                  <td style={{ padding: '0.75rem 0', textAlign: 'right' }}>₹{receipt.netTotal.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>

            {/* UPI QR & Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px dashed #333', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.6875rem', color: '#555', maxWidth: '300px' }}>
                <p style={{ fontWeight: 700, margin: '0 0 0.25rem 0' }}>Terms & Conditions:</p>
                <p style={{ margin: 0 }}>{settings.receiptFooter}</p>
              </div>

              {settings.upiQrUrl && (
                <div style={{ textAlign: 'center' }}>
                  <img src={settings.upiQrUrl} alt="UPI QR Code" style={{ width: '65px', height: '65px', borderRadius: '4px' }} />
                  <div style={{ fontSize: '0.625rem', color: '#666', marginTop: '0.125rem' }}>Pay via UPI</div>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', fontSize: '0.6875rem', color: '#888', marginTop: '0.5rem' }}>
              *** Computer Generated Official Tax Invoice & Receipt ***
            </div>

          </div>

        </div>

        <div className="modal-footer no-print">
          <button className="btn btn-secondary" onClick={onClose}>Close Preview</button>
          <button className="btn btn-primary" onClick={handlePrint}>
            <Printer size={16} />
            <span>Print Receipt</span>
          </button>
        </div>

      </div>
    </div>
  );
};
