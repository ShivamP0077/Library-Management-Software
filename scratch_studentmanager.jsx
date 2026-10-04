import React, { useState, useEffect, useMemo } from 'react';
import { useLibrary } from '../context/LibraryContext';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, UserPlus, Phone, MapPin, History, Edit, RefreshCw, 
  ArrowRightLeft, CreditCard, FileText, X, CheckCircle, AlertCircle, Trash2, Archive, Download, Clock
} from 'lucide-react';
import { RefreshButton } from './RefreshButton';
import { NumericInput } from './NumericInput';
import { ShiftManagerModal } from './Modals/ShiftManagerModal';
import { StudentExcelViewModal } from './Modals/StudentExcelViewModal';

export const StudentManager = ({ onOpenNewStudent, selectedStudent, setSelectedStudent, setActiveTab, renewActionStudent, setRenewActionStudent, relocateActionStudent, setRelocateActionStudent }) => {
  const { students, branches, activeBranchId, plans, shifts, seatTypes, renewSubscription, changeSeat, archiveStudent, cancelAdmission, cancelRenewalTransaction, getValidDesksList, getAvailableEligibleSeats, currentStaff } = useLibrary();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [shiftFilter, setShiftFilter] = useState('All');
  const [activeDrawerTab, setActiveDrawerTab] = useState('renewals'); 
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkRenewModalOpen, setIsBulkRenewModalOpen] = useState(false);
  const [bulkRenewTarget, setBulkRenewTarget] = useState([]);

  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [isSeatModalOpen, setIsSeatModalOpen] = useState(false);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isExcelViewOpen, setIsExcelViewOpen] = useState(false);

  useEffect(() => {
    if (renewActionStudent) {
      setSelectedStudent(renewActionStudent);
      const currentPlan = plans.find(p => p.id === renewActionStudent.planId) || plans[0];
      setRenewPlanId(currentPlan?.id || '');
      setRenewAmount(currentPlan?.price || 0);
      setRenewDuration(currentPlan?.durationMonths || 1);
      setRenewShift(currentPlan?.shift || '');
      setRenewDiscount(0);
      setRenewFine(0);
      setIsRenewModalOpen(true);
      if (setRenewActionStudent) setRenewActionStudent(null);
    }
  }, [renewActionStudent, plans, setSelectedStudent, setRenewActionStudent]);

  useEffect(() => {
    if (relocateActionStudent) {
      setSelectedStudent(relocateActionStudent);
      setIsSeatModalOpen(true);
      if (setRelocateActionStudent) setRelocateActionStudent(null);
    }
  }, [relocateActionStudent, setSelectedStudent, setRelocateActionStudent]);

  const [renewPlanId, setRenewPlanId] = useState('');
  const [renewDuration, setRenewDuration] = useState(1);
  const [renewShiftId, setRenewShiftId] = useState('');
  const [renewPaymentMethod, setRenewPaymentMethod] = useState('UPI');
  const [renewAmount, setRenewAmount] = useState(0);
  const [renewDiscount, setRenewDiscount] = useState(0);
  const [renewFine, setRenewFine] = useState(0);
  
  const [newBlockId, setNewBlockId] = useState('');
  const [newSeatTypeId, setNewSeatTypeId] = useState('');
  const [newSeatNo, setNewSeatNo] = useState('');
  const [newShift, setNewShift] = useState('');
  const [seatChangeReason, setSeatChangeReason] = useState('');

  // Sync initial relocate values
  useEffect(() => {
    if (isSeatModalOpen && selectedStudent) {
      setNewBlockId(selectedStudent.blockId || '');
      setNewSeatTypeId(selectedStudent.seatTypeId || '');
      setNewShiftId(selectedStudent.shiftId || '');
      setNewSeatNo('');
      setSeatChangeReason('');
    }
  }, [isSeatModalOpen, selectedStudent]);

  const activeRelocateBranch = branches.find(b => b.id === selectedStudent?.branchId);
  const activeRelocateBlock = activeRelocateBranch?.blocks?.find(b => b.id === newBlockId);

  const availableRelocateSeats = useMemo(() => {
    if (!selectedStudent || !activeRelocateBlock || !activeRelocateBlock.seats) return [];
    const targetShiftId = newShiftId || selectedStudent.shiftId;
    
    // Use the central source of truth to get available seats for this type and shift
    const availableSeatObjs = getAvailableEligibleSeats(
      selectedStudent.branchId, 
      newBlockId, 
      newSeatTypeId || selectedStudent.seatTypeId, 
      targetShiftId
    );
    
    let list = availableSeatObjs.map(seat => seat.name);
    list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    
    if (activeRelocateBlock.nonFixedSeatEnabled) {
      list.unshift('Non-Fixed Seat');
    }
    return list;
  }, [selectedStudent, newBlockId, newShiftId, activeRelocateBlock, getAvailableEligibleSeats]);

  const handleCloseSeatModal = () => {
    if ((newSeatNo || newShiftId || seatChangeReason) && !window.confirm('You have unsaved changes. Are you sure you want to close?')) {
      return;
    }
    setIsSeatModalOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isSeatModalOpen) {
        handleCloseSeatModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSeatModalOpen, newSeatNo, newShift, seatChangeReason]);

  const filteredStudents = students.filter(s => {
    if (activeBranchId !== 'all' && s.branchId !== activeBranchId) return false;
    
    if (statusFilter === 'Pending ID Proof') {
      if (s.idProofStatus !== 'Pending') return false;
    } else if (statusFilter !== 'All') {
      if (s.status !== statusFilter) return false;
    }

    if (shiftFilter !== 'All' && s.shiftId !== shiftFilter) return false;
    if (searchQuery) {
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
      
      const matchesName = s.name.toLowerCase().includes(q);
      const matchesPhone = s.phone.includes(q);

      return matchesName || matchesId || matchesPhone || matchesSeat;
    }
    return true;
  });

  const getBranchCode = (bId) => branches.find(branch => branch.id === bId)?.name || bId;

  const handleOpenRenewModal = () => {
    if (!selectedStudent) return;
    const currentPlan = plans.find(p => p.id === selectedStudent.planId) || plans[0];
    setRenewPlanId(currentPlan.id);
    setRenewAmount(currentPlan.price);
    setRenewDuration(currentPlan.durationMonths || 1);
    setRenewShiftId(currentPlan.shiftId || '');
    setRenewDiscount(0);
    setRenewFine(0);
    setIsRenewModalOpen(true);
  };

  const handleExecuteRenewal = (e) => {
    e.preventDefault();
    if (!selectedStudent) return;
    const plan = plans.find(p => p.id === renewPlanId) || plans[0];
    const currentExpiry = new Date(selectedStudent.expiryDate);
    const today = new Date();
    const startDateObj = (currentExpiry > today) ? currentExpiry : today;
    const expiryDateObj = new Date(startDateObj);
    expiryDateObj.setMonth(expiryDateObj.getMonth() + Number(renewDuration));
    
    const result = renewSubscription(selectedStudent.id, {
      planId: plan.id,
      planName: `${plan.name} (${renewDuration} Month)`,
      shiftId: renewShiftId || plan.shiftId,
      shift: shifts.find(sh => sh.id === (renewShiftId || plan.shiftId))?.name || plan.shift,
      startDate: startDateObj.toISOString().split('T')[0],
      expiryDate: expiryDateObj.toISOString().split('T')[0],
      amountPaid: renewAmount,
      discount: renewDiscount,
      fine: renewFine,
      paymentMethod: renewPaymentMethod
    });
    
    if (result && result.error) {
      toast.error(result.message);
    } else {
      toast.success('Subscription renewed successfully!');
      setIsRenewModalOpen(false);
    }
  };

  const handleExecuteSeatChange = (e) => {
    e.preventDefault();
    if (!selectedStudent || !newSeatNo || !newShiftId || !newBlockId || !newSeatTypeId) return;
    const success = changeSeat(selectedStudent.id, newBlockId, newSeatTypeId, newSeatNo, seatChangeReason, newShiftId);
    if (success !== false) {
      toast.success(`Desk for ${selectedStudent.name} updated to ${newSeatNo}`);
      setIsSeatModalOpen(false);
      setNewSeatNo('');
      setNewShiftId('');
      setSeatChangeReason('');
    }
  };

  const handleToggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filteredStudents.map(s => s.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleOpenBulkRenew = (ids) => {
    if (ids.length === 0) return;
    setBulkRenewTarget(ids);
    setRenewPlanId('keep_existing');
    setRenewAmount(0); // For bulk we might not know single price, so 0 if they keep existing
    setRenewDuration(1);
    setRenewShiftId('');
    setRenewDiscount(0);
    setRenewFine(0);
    setIsBulkRenewModalOpen(true);
  };

  const handleExecuteBulkRenewal = (e) => {
    e.preventDefault();
    if (bulkRenewTarget.length === 0) return;
    
    let successCount = 0;
    let skippedCount = 0;

    bulkRenewTarget.forEach(id => {
      const s = students.find(st => st.id === id);
      if (!s) return;

      const currentExpiry = new Date(s.expiryDate);
      const today = new Date();
      const startDateObj = (currentExpiry > today) ? currentExpiry : today;
      const expiryDateObj = new Date(startDateObj);
      expiryDateObj.setMonth(expiryDateObj.getMonth() + Number(renewDuration));
      
      const startDateStr = startDateObj.toISOString().split('T')[0];
      const expiryDateStr = expiryDateObj.toISOString().split('T')[0];

      const isDuplicate = s.renewalHistory?.some(
        r => r.startDate === startDateStr && r.endDate === expiryDateStr
      );

      if (isDuplicate) {
        skippedCount++;
        return;
      }

      let planToApply = null;
      let appliedAmount = renewAmount;
      if (renewPlanId === 'keep_existing') {
        planToApply = plans.find(p => p.id === s.planId) || plans[0];
        appliedAmount = planToApply ? planToApply.price : renewAmount;
      } else {
        planToApply = plans.find(p => p.id === renewPlanId) || plans[0];
      }
      
      if (!planToApply) return;

      const result = renewSubscription(id, {
        planId: planToApply.id,
        planName: `${planToApply.name} (${renewDuration} Month)`,
        shiftId: renewShiftId || planToApply.shiftId,
        shift: shifts.find(sh => sh.id === (renewShiftId || planToApply.shiftId))?.name || planToApply.shift,
        startDate: startDateStr,
        expiryDate: expiryDateStr,
        amountPaid: appliedAmount,
        discount: renewDiscount,
        fine: renewFine,
        paymentMethod: renewPaymentMethod
      });
      
      if (result && result.error) {
        skippedCount++;
      } else {
        successCount++;
      }
    });
    
    if (skippedCount > 0) {
      toast.success(`Renewed ${successCount} students. Skipped ${skippedCount} students (already active or duplicate).`);
    } else {
      toast.success(`Successfully renewed ${successCount} students.`);
    }
    
    setIsBulkRenewModalOpen(false);
    setSelectedIds([]);
    setIsSelectionMode(false);
  };

  const calculateBulkGrandTotal = () => {
    let total = 0;
    bulkRenewTarget.forEach(id => {
      const s = students.find(st => st.id === id);
      if (!s) return;
      
      const currentExpiry = new Date(s.expiryDate);
      const today = new Date();
      const startDateObj = (currentExpiry > today) ? currentExpiry : today;
      const expiryDateObj = new Date(startDateObj);
      expiryDateObj.setMonth(expiryDateObj.getMonth() + Number(renewDuration));
      
      const startDateStr = startDateObj.toISOString().split('T')[0];
      const expiryDateStr = expiryDateObj.toISOString().split('T')[0];

      const isDuplicate = s.renewalHistory?.some(
        r => r.startDate === startDateStr && r.endDate === expiryDateStr
      );

      if (isDuplicate) return;
      
      let basePrice = renewAmount;
      if (renewPlanId === 'keep_existing') {
        const p = plans.find(plan => plan.id === s.planId);
        basePrice = p ? p.price : renewAmount;
      }
      total += (basePrice - renewDiscount + renewFine);
    });
    return total;
  };

  const handleBulkRemove = (ids) => {
    if (ids.length === 0) return;
    const reason = window.prompt(`Enter reason for cancelling ${ids.length} admissions:`);
    if (!reason) return;
    
    let refundAmt = 0;
    if (currentStaff?.permissions?.canProcessRefunds) {
      const amtStr = window.prompt("Enter refund amount per student (if any) or 0:", "0");
      if (amtStr !== null) refundAmt = parseFloat(amtStr) || 0;
    }
    
    if (window.confirm(`Are you sure you want to cancel admission for ${ids.length} students? Refund Amount per student: ₹${refundAmt}`)) {
      let count = 0;
      ids.forEach(id => {
        if(cancelAdmission(id, reason, refundAmt)) count++;
      });
      toast.success(`Successfully cancelled ${count} admissions.`);
      setSelectedIds([]);
      setIsSelectionMode(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Student Records</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Manage enrollments, seating, and renewals</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <RefreshButton />
          <div style={{ position: 'relative', display: 'inline-block' }} onMouseLeave={() => setIsMoreActionsOpen(false)}>
            <button className="btn btn-secondary" style={{ padding: '8px 12px', fontWeight: 800, fontSize: '18px', background: 'var(--brand-primary)', color: '#fff', border: 'none' }} onClick={() => setIsMoreActionsOpen(!isMoreActionsOpen)}>
              ⋮
            </button>
            {isMoreActionsOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, display: 'flex', flexDirection: 'column', minWidth: '180px', overflow: 'hidden' }}>
                <button style={{ padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px' }} onClick={() => { onOpenNewStudent(); setIsMoreActionsOpen(false); }}>
                  <UserPlus size={14} /> New Admission
                </button>
                <button style={{ padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px' }} onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedIds([]); setIsMoreActionsOpen(false); }}>
                  <CheckCircle size={14} /> {isSelectionMode ? 'Cancel Selection' : 'Select Students'}
                </button>
                <button style={{ padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px' }} onClick={() => { setIsExcelViewOpen(true); setIsMoreActionsOpen(false); }}>
                  <Download size={14} /> View in Excel
                </button>
                <button style={{ padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px' }} onClick={() => { setActiveTab('archives'); setIsMoreActionsOpen(false); }}>
                  <History size={14} /> History
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', width: '100%' }}>
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
            <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Expiring Soon">Expiring Soon</option>
              <option value="Expired">Expired</option>
              <option value="Pending ID Proof">Pending ID Proof</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '160px' }}>
              <select className="form-select" value={shiftFilter} onChange={(e) => {
                if (e.target.value === 'manage_shifts') {
                  setIsShiftModalOpen(true);
                } else {
                  setShiftFilter(e.target.value);
                }
              }}>
                <option value="All">All Shifts</option>
                {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                <option disabled>────────</option>
                <option value="manage_shifts">⚙ Manage Shifts</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Bulk Action Bar */}
        {isSelectionMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Bulk Actions ({selectedIds.length} selected):
            </span>
            <button 
              className="btn btn-primary" 
              disabled={selectedIds.length === 0} 
              onClick={() => handleOpenBulkRenew(selectedIds)}
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              <RefreshCw size={14} /> Renew Selected
            </button>
            
            {currentStaff?.permissions?.canCancelAdmission && (
              <button 
                className="btn btn-secondary" 
                disabled={selectedIds.length === 0} 
                onClick={() => handleBulkRemove(selectedIds)}
                style={{ padding: '6px 12px', fontSize: '13px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
              >
                <Trash2 size={14} /> Remove Selected
              </button>
            )}

            <button 
              className="btn btn-ghost" 
              onClick={() => { setIsSelectionMode(false); setSelectedIds([]); }}
              style={{ padding: '6px 12px', fontSize: '13px', marginLeft: 'auto' }}
            >
              Cancel Selection
            </button>
          </div>
        )}
      </div>

      {/* Premium Data Grid */}
      <div className="table-container">
        <table className="data-grid">
          <thead>
            <tr>
              {isSelectionMode && (
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input 
                    type="checkbox" 
                    checked={filteredStudents.length > 0 && selectedIds.length === filteredStudents.length}
                    onChange={handleToggleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
              )}
              <th>STUDENT</th>
              <th>BRANCH</th>
              <th>DESK & SHIFT</th>
              <th>EXPIRY</th>
              <th>STATUS</th>
              <th style={{ textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>
                  No student records match your criteria.
                </td>
              </tr>
            ) : (
              filteredStudents.map(student => (
                <tr key={student.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedStudent(student)}>
                  {isSelectionMode && (
                    <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="checkbox" 
                        checked={selectedIds.includes(student.id)}
                        onChange={() => handleToggleSelect(student.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                  )}
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{student.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      {student.id} • {student.phone}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{getBranchCode(student.branchId)}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '12px' }}>
                        {student.seatNo}
                      </span>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{student.shift}</span>
                      {student.seatNo !== 'Non-Fixed Seat' && student.seatNo !== 'None' && (student.status === 'Active' || student.status === 'Expiring Soon') && !getValidDesksList(student.branchId, student.blockId).includes(student.seatNo) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#fee2e2', padding: '4px 8px', borderRadius: '4px' }}>
                          <AlertCircle size={12} color="#ef4444" />
                          <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>Missing from Seat Map</span>
                          <button 
                            style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '11px', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginLeft: '4px' }}
                            onClick={(e) => { e.stopPropagation(); setSelectedStudent(student); setIsSeatModalOpen(true); }}
                          >
                            Fix Allocation
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: '13px' }}>{student.expiryDate}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className={`badge badge-${student.status === 'Expired' ? 'expired' : student.status === 'Expiring Soon' ? 'expiring' : 'active'}`}>
                        {student.status}
                      </span>
                      {student.idProofStatus === 'Pending' && (
                        <span className="badge badge-expiring" style={{ fontSize: '10px' }}>ID Pending</span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={(e) => { e.stopPropagation(); setSelectedStudent(student); }}>
                      View Profile
                    </button>
                  </td>
                </tr>
              ))
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
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '18px' }}>
                    {selectedStudent.name.charAt(0)}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>{selectedStudent.name}</h3>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {selectedStudent.id} • {selectedStudent.phone} • {selectedStudent.gender || 'Male'}
                    </div>
                  </div>
                </div>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setSelectedStudent(null)}><X size={24} /></button>
              </div>

              <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', background: 'var(--bg-main)' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>ASSIGNED DESK</span>
                  <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>{selectedStudent.seatNo}</div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>SHIFT</span>
                  <div style={{ fontSize: '16px', fontWeight: 500, marginTop: '4px' }}>{selectedStudent.shift}</div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>EXPIRY DATE</span>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: selectedStudent.status === 'Expired' ? 'var(--text-primary)' : '#10b981', marginTop: '4px' }}>
                    {selectedStudent.expiryDate}
                  </div>
                </div>
                {selectedStudent.idProofStatus === 'Pending' && (
                  <div style={{ gridColumn: '1 / -1', padding: '12px', background: 'var(--bg-warning)', border: '1px solid var(--border-warning)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={16} color="var(--warning-color)" />
                    <span style={{ fontSize: '13px', color: 'var(--warning-color)', fontWeight: 500 }}>ID Proof Document is pending. Deadline: {selectedStudent.idProofDeadline}</span>
                  </div>
                )}
              </div>

              <div style={{ padding: '16px 24px', display: 'flex', gap: '12px', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={handleOpenRenewModal}><RefreshCw size={14} /> Renew Subscription</button>
                <button className="btn btn-secondary" onClick={() => {
                  setNewSeatNo(selectedStudent.seatNo || '');
                  setNewShift(selectedStudent.shift || '');
                  setSeatChangeReason('');
                  setIsSeatModalOpen(true);
                }}><ArrowRightLeft size={14} /> Relocate Desk</button>
                <div style={{ flex: 1 }}></div>
                {currentStaff?.permissions?.canCancelAdmission && (
                  <button 
                    className="btn btn-secondary" 
                    style={{ color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
                    onClick={() => {
                      const reason = window.prompt("Reason for cancellation:");
                      if (!reason) return;
                      let refundAmt = 0;
                      if (currentStaff?.permissions?.canProcessRefunds) {
                        const amtStr = window.prompt("Enter refund amount (if any) or 0:", "0");
                        if (amtStr !== null) refundAmt = parseFloat(amtStr) || 0;
                      }
                      
                      if (window.confirm(`Are you sure you want to cancel admission for ${selectedStudent.name}? Refund Amount: ₹${refundAmt}`)) {
                        cancelAdmission(selectedStudent.id, reason, refundAmt);
                        setSelectedStudent(null);
                        toast.success(`Admission cancelled for ${selectedStudent.name}.`);
                      }
                    }}
                  >
                    <Trash2 size={14} /> Cancel Admission
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', padding: '0 24px' }}>
                {['renewals', 'seats', 'payments'].map(tab => (
                  <button key={tab} onClick={() => setActiveDrawerTab(tab)} style={{ 
                    padding: '16px 24px', background: 'transparent', border: 'none', cursor: 'pointer',
                    color: activeDrawerTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: activeDrawerTab === tab ? 600 : 500,
                    borderBottom: activeDrawerTab === tab ? '2px solid var(--brand-primary)' : '2px solid transparent',
                    textTransform: 'capitalize'
                  }}>
                    {tab} History
                  </button>
                ))}
              </div>

              <div className="modal-body" style={{ minHeight: '300px' }}>
                {activeDrawerTab === 'renewals' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedStudent.renewalHistory?.map((rn, idx) => (
                      <div key={idx} style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <strong style={{ fontSize: '14px' }}>{rn.planName}</strong>
                          <span style={{ fontWeight: 600, color: '#10b981' }}>₹{rn.amountPaid.toLocaleString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            Valid: {rn.startDate} to {rn.endDate} • Staff: {rn.staffName}
                          </div>
                          {currentStaff?.permissions?.canCancelAdmission && (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '12px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to void this renewal (${rn.planName})? This will delete the payment record and restore the previous expiry.`)) {
                                  if (cancelRenewalTransaction(selectedStudent.id, rn.renewalId)) {
                                    toast.success("Renewal voided successfully.");
                                    setSelectedStudent(null);
                                  } else {
                                    toast.error("Failed to void renewal.");
                                  }
                                }
                              }}
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeDrawerTab === 'seats' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedStudent.seatHistory?.map((sh, idx) => (
                      <div key={idx} style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <strong style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {sh.previousSeat} <ArrowRightLeft size={14} /> {sh.newSeat}
                          </strong>
                          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{sh.date}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Reason: {sh.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
                {activeDrawerTab === 'payments' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedStudent.paymentHistory?.map((pay, idx) => (
                      <div key={idx} style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px' }}>{pay.receiptNo}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{pay.date} • {pay.method}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: '#10b981' }}>₹{pay.amount.toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Renew Modal */}
      <AnimatePresence>
        {isBulkRenewModalOpen && bulkRenewTarget.length > 0 && (
          <motion.div className="modal-overlay" onClick={() => setIsBulkRenewModalOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Bulk Renew ({bulkRenewTarget.length} Students)</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setIsBulkRenewModalOpen(false)}><X size={24} /></button>
              </div>
              <form onSubmit={handleExecuteBulkRenewal}>
                <div className="modal-body">
                  <div className="form-group">
                    <label className="form-label">Subscription Plan</label>
                    <select className="form-select" value={renewPlanId} onChange={(e) => {
                      setRenewPlanId(e.target.value);
                      if (e.target.value === 'keep_existing') {
                        setRenewAmount(0);
                        setRenewDuration(1);
                        setRenewShift('');
                      } else {
                        const p = plans.find(plan => plan.id === e.target.value);
                        if (p) {
                          setRenewAmount(p.price);
                          setRenewDuration(p.durationMonths || 1);
                          setRenewShiftId(p.shiftIds?.[0] || p.shiftId || '');
                        }
                      }
                    }}>
                      <option value="keep_existing">Keep Existing Plan</option>
                      {plans.map(p => <option key={p.id} value={p.id}>{p.name} - ₹{p.price}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Duration (Months)</label>
                      <NumericInput className="form-input" value={renewDuration} onChange={(e) => setRenewDuration(Number(e.target.value))} min={1} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Shift</label>
                      <select className="form-select" value={renewShiftId} onChange={(e) => {
                        const newShId = e.target.value;
                        setRenewShiftId(newShId);
                        if (newShId && renewPlanId !== 'keep_existing') {
                          const p = plans.find(plan => plan.shiftId === newShId);
                          if (p) {
                            setRenewPlanId(p.id);
                            setRenewAmount(p.price);
                            setRenewDuration(p.durationMonths || 1);
                          }
                        }
                      }}>
                        <option value="">Linked to Plan</option>
                        {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Method</label>
                      <select className="form-select" value={renewPaymentMethod} onChange={(e) => setRenewPaymentMethod(e.target.value)}>
                        <option value="UPI">UPI</option><option value="Cash">Cash</option><option value="Card">Card</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="form-group"><label className="form-label">Price (₹) per student</label><NumericInput className="form-input" value={renewAmount} onChange={(e) => setRenewAmount(Number(e.target.value))} /></div>
                    <div className="form-group"><label className="form-label">Discount (₹) per student</label><NumericInput className="form-input" value={renewDiscount} onChange={(e) => setRenewDiscount(Number(e.target.value))} /></div>
                    <div className="form-group"><label className="form-label">Fine (₹) per student</label><NumericInput className="form-input" value={renewFine} onChange={(e) => setRenewFine(Number(e.target.value))} /></div>
                  </div>
                  <div style={{ background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                    <span style={{ fontWeight: 600 }}>Grand Total for Selected Students:</span>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#10b981' }}>
                      ₹{calculateBulkGrandTotal().toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsBulkRenewModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Process Bulk Renewal</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Renew Modal */}
      <AnimatePresence>
        {isRenewModalOpen && selectedStudent && (
          <motion.div className="modal-overlay" onClick={() => setIsRenewModalOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              {(() => {
                const validRenewalPlans = plans.filter(p => 
                  p.branchId === selectedStudent.branchId && 
                  (p.blockIds?.includes(selectedStudent.blockId) || p.blockIds?.includes('all')) &&
                  p.seatTypeId === selectedStudent.seatTypeId &&
                  p.active
                );

                return (
                  <>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Renew {selectedStudent.name}</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setIsRenewModalOpen(false)}><X size={24} /></button>
              </div>
              <form onSubmit={handleExecuteRenewal}>
                <div className="modal-body">
                  <div className="form-group">
                    <label className="form-label">Subscription Plan</label>
                    <select className="form-select" value={renewPlanId} onChange={(e) => {
                      setRenewPlanId(e.target.value);
                      const p = validRenewalPlans.find(plan => plan.id === e.target.value);
                      if (p) {
                        setRenewAmount(p.price);
                        setRenewDuration(p.durationMonths || 1);
                        setRenewShiftId(p.shiftIds?.[0] || p.shiftId || '');
                      }
                    }}>
                      <option value="" disabled>Select Plan</option>
                      {validRenewalPlans.map(p => <option key={p.id} value={p.id}>{p.name} - ₹{p.price}</option>)}
                      {validRenewalPlans.length === 0 && <option value="" disabled>No valid plans found for this seat type.</option>}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Duration (Months)</label>
                      <NumericInput className="form-input" value={renewDuration} onChange={(e) => setRenewDuration(Number(e.target.value))} min={1} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Shift</label>
                      <select className="form-select" value={renewShiftId} onChange={(e) => {
                        const newShId = e.target.value;
                        setRenewShiftId(newShId);
                        if (newShId) {
                          const p = validRenewalPlans.find(plan => plan.shiftId === newShId);
                          if (p) {
                            setRenewPlanId(p.id);
                            setRenewAmount(p.price);
                            setRenewDuration(p.durationMonths || 1);
                          }
                        }
                      }}>
                        <option value="">Linked to Plan</option>
                        {shifts.filter(sh => sh.branchId === selectedStudent.branchId).map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Method</label>
                      <select className="form-select" value={renewPaymentMethod} onChange={(e) => setRenewPaymentMethod(e.target.value)}>
                        <option value="UPI">UPI</option><option value="Cash">Cash</option><option value="Card">Card</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="form-group"><label className="form-label">Price (₹)</label><NumericInput className="form-input" value={renewAmount} onChange={(e) => setRenewAmount(Number(e.target.value))} /></div>
                    <div className="form-group"><label className="form-label">Discount (₹)</label><NumericInput className="form-input" value={renewDiscount} onChange={(e) => setRenewDiscount(Number(e.target.value))} /></div>
                    <div className="form-group"><label className="form-label">Fine (₹)</label><NumericInput className="form-input" value={renewFine} onChange={(e) => setRenewFine(Number(e.target.value))} /></div>
                  </div>
                  <div style={{ background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                    <span style={{ fontWeight: 600 }}>Total Fee:</span>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#10b981' }}>₹{(renewAmount - renewDiscount + renewFine).toLocaleString()}</span>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsRenewModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={validRenewalPlans.length === 0}>Process Renewal</button>
                </div>
              </form>
              </>
              );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Seat Modal */}
      <AnimatePresence>
        {isShiftModalOpen && (
          <ShiftManagerModal 
            isOpen={isShiftModalOpen} 
            onClose={() => setIsShiftModalOpen(false)} 
          />
        )}
        
        {isExcelViewOpen && (
          <StudentExcelViewModal
            isOpen={isExcelViewOpen}
            onClose={() => setIsExcelViewOpen(false)}
            studentsData={students}
            title="Active Students"
          />
        )}

        {isSeatModalOpen && selectedStudent && (
          <motion.div className="modal-overlay" onClick={handleCloseSeatModal} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Relocate Desk</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={handleCloseSeatModal} title="Close"><X size={24} /></button>
              </div>
              <form onSubmit={handleExecuteSeatChange}>
                <div className="modal-body">
                  <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-main)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Current Assignment</div>
                    <div style={{ fontWeight: 600 }}>Seat: {selectedStudent.seatNo} | Shift: {selectedStudent.shift}</div>
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">Block / Area</label>
                    <select className="form-select" value={newBlockId} onChange={(e) => { setNewBlockId(e.target.value); setNewSeatNo(''); }} required>
                      <option value="" disabled>Select Block</option>
                      {activeRelocateBranch?.blocks?.map(blk => (
                        <option key={blk.id} value={blk.id}>{blk.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Study Shift</label>
                    <select className="form-select" value={newShiftId} onChange={(e) => { setNewShiftId(e.target.value); setNewSeatNo(''); }} required>
                      <option value="">Select Shift</option>
                      {shifts && shifts.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">Seat Type</label>
                    <select className="form-select" value={newSeatTypeId} onChange={(e) => { setNewSeatTypeId(e.target.value); setNewSeatNo(''); }} required>
                      <option value="">Select Seat Type</option>
                      {seatTypes.filter(st => st.blockId === newBlockId).map(st => (
                        <option key={st.id} value={st.id}>{st.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">New Desk</label>
                    <select className="form-select" value={newSeatNo} onChange={(e) => setNewSeatNo(e.target.value)} required disabled={!newBlockId || !newShiftId || availableRelocateSeats.length === 0}>
                      {availableRelocateSeats.length === 0 ? (
                        <option value="" disabled>No available seats</option>
                      ) : (
                        <>
                          <option value="" disabled>Select an available seat</option>
                          {availableRelocateSeats.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reason</label>
                    <input type="text" className="form-input" value={seatChangeReason} onChange={(e) => setSeatChangeReason(e.target.value)} required />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseSeatModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Update Assignment</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
