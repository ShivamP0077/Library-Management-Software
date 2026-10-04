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

export const PreviousStudentRecords = ({ setActiveTab }) => {
  const { archivedStudents, permanentlyDeleteStudent, clearArchivedHistory, branches, activeBranchId, plans, shifts } = useLibrary();

  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState('All');
  const [activeDrawerTab, setActiveDrawerTab] = useState('history'); 

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isExcelViewOpen, setIsExcelViewOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);

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
    const matchesShift = shiftFilter === 'All' || s.shiftId === shiftFilter;
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
            {shifts && shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
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
                      <span className="badge badge-error">Archived</span>
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
                    {selectedStudent.name.charAt(0)}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>{selectedStudent.name}</h3>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {selectedStudent.id} • {selectedStudent.phone}
                    </div>
                  </div>
                </div>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setSelectedStudent(null)}><X size={24} /></button>
              </div>

              <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', background: 'var(--bg-main)' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>PREVIOUS DESK</span>
                  <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>{selectedStudent.seatNo}</div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>SHIFT</span>
                  <div style={{ fontSize: '16px', fontWeight: 500, marginTop: '4px' }}>{selectedStudent.shift}</div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>STATUS</span>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#ef4444', marginTop: '4px' }}>
                    Archived
                  </div>
                </div>
              </div>

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
                {['history', 'seats', 'payments'].map(tab => (
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
                    {selectedStudent.payments?.map(payment => (
                      <div key={payment.receiptNo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#ecfdf5', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CreditCard size={18} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '14px' }}>{payment.receiptNo}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{payment.date} • {payment.method}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, fontSize: '15px' }}>₹{payment.netTotal}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end', marginTop: '2px' }}>
                            <FileText size={10} /> View Receipt
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!selectedStudent.payments || selectedStudent.payments.length === 0) && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No payments recorded.</div>
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
