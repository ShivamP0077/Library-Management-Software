import React, { useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, Phone, MapPin, History, RefreshCw, ArrowLeft,
  CreditCard, FileText, X, Trash2, Archive, Download, RotateCcw, AlertTriangle
} from 'lucide-react';
import { StudentExcelViewModal } from './Modals/StudentExcelViewModal';
import { RestoreStudentModal } from './Modals/RestoreStudentModal';
import { getCanonicalShifts, matchesShiftFilter } from '../utils/shiftUtils';

export const PreviousStudentRecords = ({ setActiveTab }) => {
  const { archivedStudents, permanentlyDeleteStudent, clearArchivedHistory, branches, activeBranchId, plans, shifts, payments } = useLibrary();

  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState('All');
  const [activeDrawerTab, setActiveDrawerTab] = useState('history'); 

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isExcelViewOpen, setIsExcelViewOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);

  const canonicalShifts = React.useMemo(() => {
    return getCanonicalShifts(shifts);
  }, [shifts]);

  // Combined & deduplicated payment records (Stable ID-first deduplication)
  const studentPayments = React.useMemo(() => {
    if (!selectedStudent) return [];
    const directHistory = selectedStudent.paymentHistory || [];
    const contextList = (payments || []).filter(p => p && p.studentId === selectedStudent.id);

    const seenIds = new Set();
    const seenIdlessKeys = new Set();
    const combined = [];

    const processRecord = (rec) => {
      if (!rec) return;
      const stableId = rec.receiptNo || rec.transactionId || rec.id || rec.paymentId;
      if (stableId) {
        const idStr = String(stableId);
        if (!seenIds.has(idStr)) {
          seenIds.add(idStr);
          combined.push(rec);
        }
      } else {
        // Fallback applied ONLY for ID-less records
        const idlessKey = `${rec.date || ''}_${rec.netTotal || rec.amount || ''}_${rec.method || ''}_${rec.type || ''}`;
        if (!seenIdlessKeys.has(idlessKey)) {
          seenIdlessKeys.add(idlessKey);
          combined.push(rec);
        }
      }
    };

    directHistory.forEach(processRecord);
    contextList.forEach(processRecord);

    return combined;
  }, [selectedStudent, payments]);

  // Combined cancellation records
  const studentCancellations = React.useMemo(() => {
    if (!selectedStudent) return [];
    const history = selectedStudent.cancellationHistory || [];
    if (history.length > 0) return history;
    if (selectedStudent.cancellationReason || selectedStudent.cancellationDate || selectedStudent.cancelledDate) {
      return [{
        cancellationId: selectedStudent.cancellationId || `CAN-${selectedStudent.id}`,
        date: selectedStudent.cancellationDate || selectedStudent.cancelledDate || 'Recorded on exit',
        reason: selectedStudent.cancellationReason || 'Admission cancelled',
        refundAmount: selectedStudent.refundAmount !== undefined ? selectedStudent.refundAmount : 0,
        staffName: selectedStudent.cancellationStaff || selectedStudent.cancelledBy || 'Staff Member'
      }];
    }
    return [];
  }, [selectedStudent]);

  // Filter Logic
  const filteredStudents = archivedStudents.filter(s => {
    const q = searchQuery.toLowerCase().trim();
    const normalizeSeat = (seat) => {
      if (!seat) return '';
      const match = String(seat).match(/^([a-zA-Z]+)\s*-?\s*0*(\d+)$/);
      return match ? `${match[1].toLowerCase()}-${match[2]}` : String(seat).toLowerCase().replace(/\s+/g, '');
    };
    const normQ = normalizeSeat(q);
    const normSeat = normalizeSeat(s.seatNo);
    const matchesSeat = normSeat.startsWith(normQ);
    
    const isShortSeatPrefix = /^[a-z]{1,2}\s*-?\s*\d{1,2}$/.test(q);
    const matchesId = isShortSeatPrefix ? false : s.id.toLowerCase().includes(q);
    
    const matchesSearch = !q || s.name.toLowerCase().includes(q) || matchesId || s.phone.includes(q) || matchesSeat;
    const matchesBranch = activeBranchId === 'all' || s.branchId === activeBranchId;
    const matchesShift = shiftFilter === 'All' || matchesShiftFilter(shifts, s, shiftFilter);
    return matchesSearch && matchesBranch && matchesShift;
  });

  const handlePermanentDelete = (studentId) => {
    if (window.confirm("Are you sure you want to permanently delete this student? This action cannot be undone.")) {
      permanentlyDeleteStudent(studentId);
      setSelectedStudent(null);
      toast.success("Student permanently deleted.");
    }
  };

  const handleClearHistory = () => {
    if (archivedStudents.length === 0) return;
    if (window.confirm("WARNING: This will permanently delete ALL archived students and their history. This action CANNOT be undone. Are you absolutely sure?")) {
      clearArchivedHistory();
      toast.success("All previous history cleared.");
    }
  };

  return (
    <motion.div className="dashboard-wrapper" initial="initial" animate="animate" exit="exit" variants={{ initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <button className="btn btn-ghost" onClick={() => setActiveTab('students')} style={{ padding: '8px', color: 'var(--text-secondary)' }} title="Back to Student Records">
              <ArrowLeft size={20} />
            </button>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>Previous Student Records</h2>
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginLeft: '48px', marginTop: '0' }}>Manage archived student history</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setIsExcelViewOpen(true)}>
            <Download size={16} /> View in Excel
          </button>
          <button 
            className="btn btn-secondary" 
            style={{ color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
            onClick={handleClearHistory}
            disabled={archivedStudents.length === 0}
          >
            <AlertTriangle size={16} /> Clear History
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="premium-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', padding: '16px', marginBottom: '24px' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <Search size={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text" className="form-input"
            placeholder="Search by ID, Name, Phone, or Desk..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '36px' }}
          />
        </div>
        
        <div style={{ width: '160px' }}>
          <select className="form-select" value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}>
            <option value="All">All Shifts</option>
            {canonicalShifts.map(sh => <option key={sh.id} value={sh.name}>{sh.name}</option>)}
          </select>
        </div>
      </div>

      {/* Data Grid */}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data-grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Student Name</th>
              <th>Branch</th>
              <th>Previous Seat</th>
              <th>Shift</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {filteredStudents.map(student => {
                const branchName = branches.find(b => b.id === student.branchId)?.name || 'Unknown';
                return (
                  <motion.tr 
                    key={student.id} 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => {
                      setSelectedStudent(student);
                      setActiveDrawerTab('history');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{student.id}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '13px' }}>
                          {student.name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{student.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <Phone size={10} /> {student.phone}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14} color="var(--text-tertiary)"/> {branchName}</div></td>
                    <td><div style={{ fontWeight: 600 }}>{student.seatNo}</div></td>
                    <td><div style={{ fontSize: '13px', background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>{student.shift}</div></td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span className="badge badge-error">Archived</span>
                        {student.cancellationHistory && student.cancellationHistory.length > 0 && (
                          <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 500 }}>
                            Reason: {student.cancellationHistory[0].reason}
                          </span>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
            
            {filteredStudents.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                  <Archive size={32} style={{ margin: '0 auto 12px auto', opacity: 0.2 }} />
                  <div>No archived students found matching your criteria.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {selectedStudent && (
          <motion.div className="modal-overlay" onClick={() => setSelectedStudent(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" style={{ maxWidth: '800px' }} onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
              
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--text-tertiary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '18px' }}>
                    {(selectedStudent.name || 'S').charAt(0)}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>{selectedStudent.name || 'Student'}</h3>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {selectedStudent.id} • {selectedStudent.phone || 'No Phone'}
                      {selectedStudent.emergencyPhone && <span> • 🚨 Emergency: {selectedStudent.emergencyPhone}</span>}
                    </div>
                  </div>
                </div>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setSelectedStudent(null)}><X size={24} /></button>
              </div>

              <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', background: 'var(--bg-main)' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>PREVIOUS DESK</span>
                  <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>{selectedStudent.seatNo || 'None'}</div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>SHIFT</span>
                  <div style={{ fontSize: '16px', fontWeight: 500, marginTop: '4px' }}>{selectedStudent.shift || 'None'}</div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>STATUS</span>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#ef4444', marginTop: '4px' }}>
                    Archived
                  </div>
                </div>
              </div>

              {studentCancellations.length > 0 && (
                <div style={{ margin: '0 24px 16px 24px', padding: '14px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '13px', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertTriangle size={15} /> Cancellation Details
                    </strong>
                    <span style={{ fontSize: '12px', color: '#7f1d1d' }}>{studentCancellations[0].date}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#991b1b', lineHeight: 1.4 }}>
                    <strong>Reason:</strong> {studentCancellations[0].reason}
                  </div>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '12px', color: '#b91c1c' }}>
                    <span>Processed By: <strong>{studentCancellations[0].staffName || 'Admin'}</strong></span>
                    {studentCancellations[0].refundAmount > 0 && (
                      <span>Refund: <strong>₹{studentCancellations[0].refundAmount?.toLocaleString()}</strong></span>
                    )}
                  </div>
                </div>
              )}

              <div style={{ padding: '16px 24px', display: 'flex', gap: '12px', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                <button className="btn btn-primary" onClick={() => setIsRestoreModalOpen(true)}>
                  <RotateCcw size={14} /> Restore Student
                </button>
                <div style={{ flex: 1 }}></div>
                <button 
                  className="btn btn-secondary" 
                  style={{ color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
                  onClick={() => handlePermanentDelete(selectedStudent.id)}
                >
                  <Trash2 size={14} /> Delete Permanently
                </button>
              </div>

              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', padding: '0 24px' }}>
                {['history', 'seats', 'payments', 'cancellations'].map(tab => (
                  <button key={tab} onClick={() => setActiveDrawerTab(tab)} style={{ 
                    padding: '16px 24px', background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: '14px', fontWeight: 600, color: activeDrawerTab === tab ? 'var(--brand-primary)' : 'var(--text-secondary)',
                    borderBottom: activeDrawerTab === tab ? '2px solid var(--brand-primary)' : '2px solid transparent',
                    textTransform: 'capitalize'
                  }}>
                    {tab === 'history' ? 'Renewals' : tab}
                  </button>
                ))}
              </div>

              <div style={{ padding: '24px', maxHeight: '300px', overflowY: 'auto' }}>
                {activeDrawerTab === 'history' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedStudent.renewalHistory?.map(record => {
                      const planInfo = plans.find(p => p.id === record.planId);
                      return (
                        <div key={record.renewalId} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)' }}>
                            <RefreshCw size={14} color="var(--text-secondary)" />
                          </div>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600 }}>{record.type === 'Admission' ? 'Initial Admission' : 'Subscription Renewed'}</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              {planInfo ? planInfo.name : 'Unknown Plan'} • {record.durationMonths} Month(s)
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                              Processed on {record.date} by {record.staffName}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {(!selectedStudent.renewalHistory || selectedStudent.renewalHistory.length === 0) && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No renewal history found.</div>
                    )}
                  </div>
                )}

                {activeDrawerTab === 'seats' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedStudent.seatHistory?.map(record => (
                      <div key={record.changeId} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)' }}>
                          <MapPin size={14} color="var(--text-secondary)" />
                        </div>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600 }}>Moved to Desk {record.newSeat}</div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            Previously at {record.previousSeat} • Reason: {record.reason}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                            Changed on {record.date} by {record.staffName}
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!selectedStudent.seatHistory || selectedStudent.seatHistory.length === 0) && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No seat changes recorded.</div>
                    )}
                  </div>
                )}

                {activeDrawerTab === 'payments' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {studentPayments.map((payment, pIdx) => {
                      const txId = payment.receiptNo || payment.transactionId || payment.id || `TXN-${pIdx + 1}`;
                      const amount = payment.netTotal !== undefined ? payment.netTotal : (payment.amount !== undefined ? payment.amount : 0);
                      const isRefund = payment.type === 'Refund' || amount < 0 || payment.status === 'Refunded';
                      return (
                        <div key={txId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: isRefund ? '#fef2f2' : '#ecfdf5', color: isRefund ? '#ef4444' : '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <CreditCard size={18} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>{txId}</span>
                                {isRefund && (
                                  <span style={{ fontSize: '11px', background: '#fee2e2', color: '#b91c1c', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Refund</span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                {payment.date || 'N/A'} • {payment.method || 'Standard'} {payment.staffName ? `• by ${payment.staffName}` : ''}
                              </div>
                              {payment.reason && (
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Reason: {payment.reason}</div>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, fontSize: '15px', color: isRefund ? '#ef4444' : 'var(--text-primary)' }}>
                              {isRefund ? `-₹${Math.abs(amount)}` : `₹${amount}`}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                              {payment.status || 'Completed'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {studentPayments.length === 0 && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>
                        No payments recorded for this student.
                      </div>
                    )}
                  </div>
                )}

                {activeDrawerTab === 'cancellations' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {studentCancellations.map((can, cIdx) => (
                      <div key={can.cancellationId || `can-${cIdx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px', background: 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px' }}>
                            <AlertTriangle size={18} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '14px' }}>
                              {can.cancellationId || 'Admission Cancellation'}
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              Reason: <strong style={{ color: 'var(--text-primary)' }}>{can.reason || 'No reason specified'}</strong>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                              Processed on {can.date || 'N/A'} {can.staffName ? `by ${can.staffName}` : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>REFUND AMOUNT</div>
                          <div style={{ fontWeight: 700, fontSize: '15px', color: can.refundAmount > 0 ? '#ef4444' : 'var(--text-secondary)', marginTop: '2px' }}>
                            {can.refundAmount > 0 ? `₹${can.refundAmount}` : '₹0 (No Refund)'}
                          </div>
                        </div>
                      </div>
                    ))}
                    {studentCancellations.length === 0 && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>
                        No cancellation records found for this student.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isExcelViewOpen && (
          <StudentExcelViewModal
            isOpen={isExcelViewOpen}
            onClose={() => setIsExcelViewOpen(false)}
            studentsData={archivedStudents}
            title="Archived Students"
          />
        )}
        
        {isRestoreModalOpen && selectedStudent && (
          <RestoreStudentModal
            isOpen={isRestoreModalOpen}
            onClose={() => setIsRestoreModalOpen(false)}
            student={selectedStudent}
            onRestoreComplete={() => {
              setIsRestoreModalOpen(false);
              setSelectedStudent(null);
            }}
          />
        )}
      </AnimatePresence>

    </motion.div>
  );
};
