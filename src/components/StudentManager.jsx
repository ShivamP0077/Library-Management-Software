import React, { useState, useEffect, useMemo } from 'react';
import { useLibrary } from '../context/LibraryContext';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, UserPlus, Phone, MapPin, History, Edit, RefreshCw, 
  ArrowRightLeft, CreditCard, FileText, X, CheckCircle, AlertCircle, Trash2, Archive, Download, Clock
} from 'lucide-react';
import { NumericInput } from './NumericInput';
import { ShiftManagerModal } from './Modals/ShiftManagerModal';
import { StudentExcelViewModal } from './Modals/StudentExcelViewModal';
import { BulkStudentModal } from './Modals/BulkStudentModal';
import { EditStudentModal } from './Modals/EditStudentModal';
import { handleSplitAmountChange, handleAddSplitComponent, handleRemoveSplitComponent, validateSplitPayment } from '../utils/splitPaymentUtils';
import { calculateSubscriptionExpiry, calculateRenewalStartDate, getSubscriptionStatus, formatDate } from '../utils/dateUtils';
import { getDocumentBlob, saveDocumentBlob } from '../utils/idbStorage';

export const StudentManager = ({ onOpenNewStudent, selectedStudent, setSelectedStudent, setActiveTab, renewActionStudent, setRenewActionStudent, relocateActionStudent, setRelocateActionStudent }) => {
  const { 
    settings, students, branches, sections, activeBranchId, plans, shifts, seatTypes, 
    renewSubscription, changeSeat, addStudentDocument, extendStudentDueDate, archiveStudent, 
    cancelAdmission, cancelRenewalTransaction, getValidDesksList, getAvailableEligibleSeats, 
    currentStaff, waitingList, removeFromWaitingList, updateWaitingListStatus 
  } = useLibrary();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [shiftFilter, setShiftFilter] = useState('All');
  const [activeDrawerTab, setActiveDrawerTab] = useState('history');
  const [viewMode, setViewMode] = useState('active'); // active | waiting 
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isExcelViewOpen, setIsExcelViewOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkRenewModalOpen, setIsBulkRenewModalOpen] = useState(false);
  const [bulkRenewTarget, setBulkRenewTarget] = useState([]);

  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [isSeatModalOpen, setIsSeatModalOpen] = useState(false);

  useEffect(() => {
    if (renewActionStudent) {
      setSelectedStudent(renewActionStudent);
      const currentPlan = plans.find(p => p.id === renewActionStudent.planId) || plans[0];
      const pricing = currentPlan?.durationPricing || [];
      const tier = pricing.find(dp => dp.durationMonths === 1) || pricing[0];
      const base = tier ? tier.basePrice : (currentPlan?.price || 1500);
      let disc = 0;
      if (tier?.discountType === 'Percentage') disc = Math.round((base * tier.discountValue) / 100);
      else if (tier?.discountType === 'Fixed') disc = tier.discountValue;

      setRenewPlanId(currentPlan?.id || '');
      setRenewAmount(base);
      setRenewDuration(tier?.durationMonths || 1);
      setRenewShiftId(currentPlan?.shiftIds?.[0] || '');
      setRenewDiscount(disc);
      setRenewFine(0);
      setRenewPaymentMethod('');
      setRenewSplitBreakdown([{ method: '', amount: '' }]);
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
  const [renewPaymentMethod, setRenewPaymentMethod] = useState('');
  const [renewSplitBreakdown, setRenewSplitBreakdown] = useState([{ method: '', amount: '' }]);
  const [renewAmount, setRenewAmount] = useState(0);
  const [renewDiscount, setRenewDiscount] = useState(0);
  const [renewFine, setRenewFine] = useState(0);
  
  const [relocateBranchId, setRelocateBranchId] = useState('');
  const [newBlockId, setNewBlockId] = useState('');
  const [newSeatTypeId, setNewSeatTypeId] = useState('');
  const [newSeatNo, setNewSeatNo] = useState('');
  const [newShiftId, setNewShiftId] = useState('');
  const [seatChangeReason, setSeatChangeReason] = useState('');

  // Document preview & extension state
  const [previewDoc, setPreviewDoc] = useState(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const [extendReason, setExtendReason] = useState('Payment extension granted');
  const [isEditStudentModalOpen, setIsEditStudentModalOpen] = useState(false);

  // Sync initial relocate values
  useEffect(() => {
    if (isSeatModalOpen && selectedStudent) {
      setRelocateBranchId(selectedStudent.branchId || (branches[0] ? branches[0].id : ''));
      setNewBlockId(selectedStudent.sectionId || '');
      setNewSeatTypeId(selectedStudent.seatTypeId || '');
      setNewShiftId(selectedStudent.shiftId || '');
      setNewSeatNo('');
      setSeatChangeReason('');
    }
  }, [isSeatModalOpen, selectedStudent, branches]);

  const activeRelocateBranch = branches.find(b => b.id === (relocateBranchId || selectedStudent?.branchId));
  const activeRelocateBlock = sections.find(b => b.id === newBlockId);

  const validRelocateShifts = useMemo(() => {
    return shifts.filter(sh => {
      if (sh.active === false) return false;
      const bId = relocateBranchId || selectedStudent?.branchId;
      if (bId && bId !== 'all' && sh.branchId && sh.branchId !== 'all' && sh.branchId !== bId) return false;
      if (newBlockId && newBlockId !== 'all' && sh.sectionId && sh.sectionId !== 'all' && sh.sectionId !== newBlockId) return false;
      return true;
    });
  }, [shifts, relocateBranchId, selectedStudent?.branchId, newBlockId]);

  useEffect(() => {
    if (newShiftId && !validRelocateShifts.find(sh => sh.id === newShiftId)) {
      setNewShiftId('');
      setNewSeatNo('');
    }
  }, [validRelocateShifts, newShiftId]);

  const availableRelocateSeats = useMemo(() => {
    if (!selectedStudent || !activeRelocateBlock) return [];
    const targetShiftId = newShiftId || selectedStudent.shiftId;
    
    // Use the central source of truth to get available seats for this type and shift
    const availableSeatObjs = getAvailableEligibleSeats(
      selectedStudent.libraryId || settings.libraryId,
      relocateBranchId || selectedStudent.branchId, 
      newBlockId, 
      newSeatTypeId || selectedStudent.seatTypeId, 
      targetShiftId
    );
    
    let list = availableSeatObjs.map(seat => seat.name);
    list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    
    const hasNonFixed = seatTypes.some(st => st.sectionId === newBlockId && st.allocationMode === 'Non-Fixed');
    if (hasNonFixed) {
      list.unshift('Non-Fixed Seat');
    }
    return list;
  }, [selectedStudent, relocateBranchId, newBlockId, newShiftId, activeRelocateBlock, getAvailableEligibleSeats, settings.libraryId, seatTypes, newSeatTypeId]);

  const handleViewDocument = async (docObj) => {
    if (!docObj.storageKey) {
      toast.error('No stored document file found.');
      return;
    }
    setIsLoadingDoc(true);
    try {
      const blobData = await getDocumentBlob(docObj.storageKey);
      if (blobData) {
        setPreviewDoc({
          name: docObj.name || 'Student Document',
          fileName: docObj.fileName || 'document.png',
          dataUrl: blobData
        });
      } else {
        toast.error('Document file not found in local storage.');
      }
    } catch (e) {
      console.error('Error loading document:', e);
      toast.error('Could not load document preview.');
    } finally {
      setIsLoadingDoc(false);
    }
  };

  const handleAttachDocumentToStudent = (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedStudent) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const base64Data = ev.target.result;
        const storageKey = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await saveDocumentBlob(storageKey, base64Data);
        const docObj = {
          id: storageKey,
          name: file.name.split('.')[0] || "Student ID",
          fileName: file.name,
          fileType: file.type,
          storageKey,
          uploadedAt: new Date().toISOString()
        };
        addStudentDocument(selectedStudent.id, docObj);
        setSelectedStudent(prev => ({
          ...prev,
          documents: [...(prev.documents || []), docObj],
          idProofStatus: "Verified"
        }));
        toast.success(`Attached ${file.name}`);
      } catch (err) {
        console.error('Attach doc failed:', err);
        toast.error('Failed to attach document.');
      }
    };
    reader.readAsDataURL(file);
  };

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
  }, [isSeatModalOpen, newSeatNo, newShiftId, seatChangeReason]);

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
    const pricing = currentPlan?.durationPricing || [];
    const tier = pricing.find(dp => dp.durationMonths === 1) || pricing[0];
    const base = tier ? tier.basePrice : (currentPlan?.price || 1500);
    let disc = 0;
    if (tier?.discountType === 'Percentage') disc = Math.round((base * tier.discountValue) / 100);
    else if (tier?.discountType === 'Fixed') disc = tier.discountValue;

    setRenewPlanId(currentPlan?.id || '');
    setRenewAmount(base);
    setRenewDuration(tier?.durationMonths || 1);
    setRenewShiftId(selectedStudent.shiftId || currentPlan?.shiftIds?.[0] || '');
    setRenewDiscount(disc);
    setRenewFine(0);
    setRenewPaymentMethod('');
    setRenewSplitBreakdown([{ method: '', amount: '' }]);
    setIsRenewModalOpen(true);
  };

  const handleExecuteRenewal = (e) => {
    e.preventDefault();
    if (!selectedStudent) return;
    if (!renewPaymentMethod) {
      toast.error("Please select a payment method.");
      return;
    }
    const parsedDur = Number(renewDuration);
    if (!parsedDur || parsedDur < 1) {
      toast.error("Valid Subscription Duration (>= 1) is required.");
      return;
    }
    const netPayable = renewAmount - renewDiscount + renewFine;
    if (renewPaymentMethod === 'Split') {
      const splitCheck = validateSplitPayment(renewSplitBreakdown, netPayable);
      if (!splitCheck.valid) {
        toast.error(splitCheck.error);
        return;
      }
    }

    const plan = plans.find(p => p.id === renewPlanId) || plans[0];
    const startStr = calculateRenewalStartDate(selectedStudent.expiryDate);
    const expiryStr = calculateSubscriptionExpiry(startStr, renewDuration);
    
    const result = renewSubscription(selectedStudent.id, {
      planId: plan.id,
      planName: `${plan.name} (${renewDuration} Month)`,
      shiftId: renewShiftId || plan.shiftIds?.[0] || selectedStudent.shiftId,
      shift: shifts.find(sh => sh.id === (renewShiftId || plan.shiftIds?.[0]))?.name || selectedStudent.shift,
      startDate: startStr,
      expiryDate: expiryStr,
      amountPaid: renewAmount,
      discount: renewDiscount,
      fine: renewFine,
      paymentMethod: renewPaymentMethod,
      breakdown: renewPaymentMethod === 'Split' ? renewSplitBreakdown : undefined
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
    const effectiveBranchId = relocateBranchId || selectedStudent.branchId;
    const success = changeSeat(selectedStudent.id, newBlockId, newSeatTypeId, newSeatNo, seatChangeReason, newShiftId, effectiveBranchId);
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
    setRenewPaymentMethod('');
    setIsBulkRenewModalOpen(true);
  };

  const handleExecuteBulkRenewal = (e) => {
    e.preventDefault();
    if (bulkRenewTarget.length === 0) return;
    if (!renewPaymentMethod) {
      toast.error("Please select a payment method.");
      return;
    }
    const parsedDur = Number(renewDuration);
    if (!parsedDur || parsedDur < 1) {
      toast.error("Valid Subscription Duration (>= 1) is required.");
      return;
    }
    if (renewPaymentMethod === 'Split') {
      toast.error("Split payments are not supported in Bulk Renew. Please select a single payment method.");
      return;
    }
    
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
        
        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '8px', padding: '4px', margin: '0 16px' }}>
          <button className={`btn ${viewMode === 'active' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode('active')} style={{ padding: '6px 16px' }}>Active Students</button>
          <button className={`btn ${viewMode === 'waiting' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode('waiting')} style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Waiting List
            {waitingList.length > 0 && <span style={{ background: viewMode === 'waiting' ? '#fff' : 'var(--brand-primary)', color: viewMode === 'waiting' ? 'var(--brand-primary)' : '#fff', borderRadius: '12px', padding: '2px 6px', fontSize: '10px', fontWeight: 700 }}>{waitingList.length}</span>}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'inline-block' }} onMouseLeave={() => setIsMoreActionsOpen(false)}>
            <button className="btn btn-secondary" style={{ padding: '8px 12px', fontWeight: 800, fontSize: '18px', background: 'var(--brand-primary)', color: '#fff', border: 'none' }} onClick={() => setIsMoreActionsOpen(!isMoreActionsOpen)}>
              ⋮
            </button>
            {isMoreActionsOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, display: 'flex', flexDirection: 'column', minWidth: '180px', overflow: 'hidden' }}>
                <button style={{ padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px' }} onClick={() => { onOpenNewStudent(); setIsMoreActionsOpen(false); }}>
                  <UserPlus size={14} /> New Admission
                </button>
                <button style={{ padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px' }} onClick={() => { setIsBulkModalOpen(true); setIsMoreActionsOpen(false); }}>
                  <Users size={14} /> Bulk Admission
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

      {viewMode === 'active' && (
      <>
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
                      {student.seatNo !== 'Non-Fixed Seat' && student.seatNo !== 'None' && (student.status === 'Active' || student.status === 'Expiring Soon') && !getValidDesksList(student.branchId, student.sectionId).includes(student.seatNo) && (
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
                    {(() => {
                      const subStatus = getSubscriptionStatus(student, settings?.gracePeriodDays);
                      const badgeClass = subStatus.status === 'Expired' 
                        ? 'badge-expired' 
                        : (subStatus.isGrace ? 'badge-expiring' : 'badge-active');
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className={`badge ${badgeClass}`}>
                            {subStatus.label}
                          </span>
                          {student.extendedDueDate && (
                            <span style={{ fontSize: '10px', color: 'var(--brand-primary)', fontWeight: 600 }}>
                              Ext: {student.extendedDueDate}
                            </span>
                          )}
                          {!student.id && (
                            <span className="badge badge-expiring" style={{ fontSize: '10px' }}>ID Pending</span>
                          )}
                        </div>
                      );
                    })()}
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

      </>
      )}


      {/* Waiting List View */}
      {viewMode === 'waiting' && (
        <div className="premium-card" style={{ padding: '16px' }}>
           <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
             <Clock size={20} /> Waiting List & Vacancy Matcher
           </h3>
           
           {waitingList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>
                No students currently in the waiting list.
              </div>
           ) : (
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>PRIORITY</th>
                    <th>STUDENT</th>
                    <th>PREFERENCES</th>
                    <th>STATUS</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {waitingList.sort((a,b) => a.priority - b.priority).map((wl) => {
                    const st = seatTypes.find(s => s.id === wl.seatTypeId);
                    const sh = shifts.find(s => s.id === wl.shiftId);
                    
                    const availableSeats = getAvailableEligibleSeats(wl.libraryId, wl.branchId, wl.sectionId, wl.seatTypeId, wl.shiftId);
                    const isMatch = availableSeats.length > 0;
                    
                    return (
                      <tr key={wl.id || wl.studentId}>
                        <td>
                           <span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600 }}>#{wl.priority}</span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{wl.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{wl.phone}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: '13px' }}>{st?.name || 'Any Seat'}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sh?.name || 'Any Shift'}</div>
                        </td>
                        <td>
                           {wl.status === 'WAITING' && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef3c7', color: '#d97706', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <Clock size={14} /> Waiting ({isMatch ? `${availableSeats.length} Vacant` : 'No Vacancy'})
                              </div>
                           )}
                           {wl.status === 'OFFERED' && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dbeafe', color: '#2563eb', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <Bell size={14} /> Offered
                              </div>
                           )}
                           {wl.status === 'ADMITTED' && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#ecfdf5', color: '#059669', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <CheckCircle size={14} /> Admitted
                              </div>
                           )}
                           {wl.status === 'CANCELLED' && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef2f2', color: '#dc2626', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <XCircle size={14} /> Cancelled
                              </div>
                           )}
                           {wl.status === 'EXPIRED' && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f3f4f6', color: '#4b5563', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <History size={14} /> Expired
                              </div>
                           )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {wl.status === 'WAITING' && (
                            <>
                              {isMatch && (
                                 <button className="btn btn-primary" style={{ padding: '6px 12px', marginRight: '8px' }} onClick={() => {
                                   if (window.confirm(`Offer vacancy to ${wl.name}?`)) {
                                     updateWaitingListStatus(wl.id, 'OFFERED');
                                   }
                                 }}>
                                   Offer Vacancy
                                 </button>
                              )}
                              <button className="btn btn-ghost" style={{ padding: '6px 12px', color: '#ef4444' }} onClick={() => {
                                if (window.confirm(`Cancel waiting list entry for ${wl.name}?`)) {
                                  updateWaitingListStatus(wl.id, 'CANCELLED');
                                }
                              }}>
                                Cancel
                              </button>
                            </>
                          )}
                          {wl.status === 'OFFERED' && (
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                              <button className="btn btn-primary" style={{ padding: '6px 12px', background: '#059669', borderColor: '#047857' }} onClick={() => {
                                toast.success('Please fill the admission form for this student to complete admission.');
                                onOpenNewStudent(wl);
                              }}>
                                Admit
                              </button>
                              <select 
                                className="form-input" 
                                style={{ width: 'auto', padding: '4px 8px', fontSize: '12px', height: '30px' }}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    if (window.confirm(`Change status to ${e.target.value}?`)) {
                                      updateWaitingListStatus(wl.id, e.target.value);
                                    }
                                    e.target.value = '';
                                  }
                                }}
                                value=""
                              >
                                <option value="" disabled>Actions...</option>
                                <option value="CANCELLED">Student Declined</option>
                                <option value="EXPIRED">Offer Expired</option>
                              </select>
                            </div>
                          )}
                          {['ADMITTED', 'CANCELLED', 'EXPIRED'].includes(wl.status) && (
                            <button className="btn btn-ghost" style={{ padding: '6px 12px', color: '#9ca3af' }} onClick={() => {
                                if (window.confirm(`Remove historical record for ${wl.name}?`)) {
                                  removeFromWaitingList(wl.id || wl.studentId);
                                }
                            }}>
                              Remove Log
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
           )}
        </div>
      )}


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
                <button className="btn btn-secondary" onClick={() => setIsSeatModalOpen(true)}>
                  <ArrowRightLeft size={14} /> Relocate Desk
                </button>
                <button className="btn btn-secondary" onClick={() => {
                  setExtendDate(selectedStudent.extendedDueDate || selectedStudent.expiryDate);
                  setExtendReason(selectedStudent.extensionReason || 'Payment extension granted');
                  setIsExtendModalOpen(true);
                }}><Clock size={14} /> Extend Due Date</button>
                <button className="btn btn-secondary" onClick={() => setIsEditStudentModalOpen(true)}><Edit size={14} /> Edit Student Details</button>
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
                {['history', 'payments', 'documents'].map(tab => (
                  <button key={tab} onClick={() => setActiveDrawerTab(tab)} style={{ 
                    padding: '16px 24px', background: 'transparent', border: 'none', cursor: 'pointer',
                    color: activeDrawerTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: activeDrawerTab === tab ? 600 : 500,
                    borderBottom: activeDrawerTab === tab ? '2px solid var(--brand-primary)' : '2px solid transparent',
                    textTransform: 'capitalize'
                  }}>
                    {tab}
                  </button>
                ))}
              </div>

              <div className="modal-body" style={{ minHeight: '300px' }}>
                {activeDrawerTab === 'history' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(() => {
                      const h = [];
                      if (selectedStudent.renewalHistory) {
                        selectedStudent.renewalHistory.forEach(r => h.push({...r, _type: 'Renewal', _date: r.startDate || r.date}));
                      }
                      if (selectedStudent.seatHistory) {
                        selectedStudent.seatHistory.forEach(r => h.push({...r, _type: 'Relocation', _date: r.date}));
                      }
                      if (selectedStudent.cancellationHistory) {
                        selectedStudent.cancellationHistory.forEach(r => h.push({...r, _type: 'Cancellation', _date: r.date}));
                      }
                      h.sort((a, b) => new Date(b._date || 0) - new Date(a._date || 0));

                      if (h.length === 0) return <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>No history records found.</div>;

                      return h.map((record, idx) => {
                        if (record._type === 'Renewal') {
                          return (
                            <div key={idx} style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '14px' }}>{record.planName} (Renewal)</strong>
                                <span style={{ fontWeight: 600, color: '#10b981' }}>₹{record.amountPaid?.toLocaleString()}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  Valid: {record.startDate} to {record.endDate} • Staff: {record.staffName}
                                </div>
                                {currentStaff?.permissions?.canCancelAdmission && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 8px', fontSize: '12px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}
                                    onClick={() => {
                                      if (window.confirm(`Are you sure you want to void this renewal (${record.planName})?`)) {
                                        if (cancelRenewalTransaction(selectedStudent.id, record.renewalId)) {
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
                          );
                        } else if (record._type === 'Relocation') {
                          return (
                            <div key={idx} style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {record.previousBranchName ? `${record.previousBranchName} (${record.previousSeat})` : record.previousSeat} 
                                  <ArrowRightLeft size={14} /> 
                                  {record.newBranchName ? `${record.newBranchName} (${record.newSeat})` : record.newSeat}
                                </strong>
                                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{record.date}</span>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Reason: {record.reason} • Staff: {record.staffName || "Admin"}</div>
                            </div>
                          );
                        } else if (record._type === 'Cancellation') {
                          return (
                            <div key={idx} style={{ padding: '16px', border: '1px solid #fee2e2', background: '#fef2f2', borderRadius: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '14px', color: '#ef4444' }}>Admission Cancelled</strong>
                                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{record.date}</span>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                Reason: {record.reason} • Refund: ₹{record.refundAmount} • Staff: {record.staffName}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      });
                    })()}
                  </div>
                )}
                {activeDrawerTab === 'payments' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedStudent.paymentHistory?.map((pay, idx) => (
                      <div key={idx} style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px' }}>{pay.receiptNo}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{pay.date} • {pay.method} • Staff: {pay.staffName || "Admin"}</div>
                          {pay.reason && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '2px' }}>Reason: {pay.reason}</div>}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: (pay.type === 'Refund' || pay.amount < 0) ? '#ef4444' : '#10b981' }}>
                            {pay.type === 'Refund' || pay.amount < 0 ? `-₹${Math.abs(pay.amount).toLocaleString()} (Refund)` : `₹${(pay.netTotal || pay.amount).toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeDrawerTab === 'documents' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>Attached Verification Documents</span>
                      <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                        + Add Document
                        <input type="file" style={{ display: 'none' }} accept="image/*,.pdf" onChange={handleAttachDocumentToStudent} />
                      </label>
                    </div>
                    {(!selectedStudent.documents || selectedStudent.documents.length === 0) ? (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px', border: '1px dashed var(--border-light)', borderRadius: '8px' }}>
                        No documents attached for this student.
                      </div>
                    ) : (
                      selectedStudent.documents.map((doc, idx) => {
                        const docObj = typeof doc === 'object' && doc !== null ? doc : { name: String(doc) };
                        return (
                          <div key={idx} style={{ padding: '14px 16px', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{docObj.name || docObj.fileName || 'Attached ID Document'}</div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                {docObj.fileName ? `${docObj.fileName} • ` : ''}{docObj.uploadedAt ? new Date(docObj.uploadedAt).toLocaleDateString() : 'Verified'}
                              </div>
                            </div>
                            <div>
                              {docObj.storageKey ? (
                                <button className="btn btn-secondary btn-sm" onClick={() => handleViewDocument(docObj)}>
                                  View Document
                                </button>
                              ) : (
                                <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>✓ Verified</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
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
                        setRenewShiftId('');
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
                      <NumericInput className="form-input" value={renewDuration} onChange={(e) => setRenewDuration(e.target.value)} min={1} />
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
                        <option value="">-- Method --</option><option value="UPI">UPI</option><option value="Cash">Cash</option><option value="Card">Card</option><option value="Bank Transfer">Bank Transfer</option>
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
                  p.active !== false &&
                  (!p.branchId || p.branchId === 'all' || p.branchId === selectedStudent.branchId) &&
                  (!p.seatTypeId || p.seatTypeId === selectedStudent.seatTypeId)
                );

                const handlePlanSelect = (pId) => {
                  setRenewPlanId(pId);
                  const p = validRenewalPlans.find(plan => plan.id === pId);
                  if (p) {
                    const pricing = p.durationPricing || [];
                    const tier = pricing.find(dp => dp.durationMonths === renewDuration) || pricing[0];
                    const base = tier ? tier.basePrice : (p.price || 1500);
                    let disc = 0;
                    if (tier?.discountType === 'Percentage') disc = Math.round((base * tier.discountValue) / 100);
                    else if (tier?.discountType === 'Fixed') disc = tier.discountValue;

                    setRenewAmount(base);
                    setRenewDiscount(disc);
                    setRenewDuration(tier?.durationMonths || 1);
                    setRenewShiftId(selectedStudent.shiftId || p.shiftIds?.[0] || '');
                  }
                };

                const handleDurationChange = (dur) => {
                  setRenewDuration(dur);
                  const numDur = dur === '' ? 0 : Number(dur);
                  const p = validRenewalPlans.find(plan => plan.id === renewPlanId);
                  if (p && p.durationPricing && numDur > 0) {
                    const match = p.durationPricing.find(dp => dp.durationMonths === numDur);
                    if (match) {
                      setRenewAmount(match.basePrice);
                      let disc = 0;
                      if (match.discountType === 'Percentage') disc = Math.round((match.basePrice * match.discountValue) / 100);
                      else if (match.discountType === 'Fixed') disc = match.discountValue;
                      setRenewDiscount(disc);
                      return;
                    }
                  }
                  // Authoritative calculation: unit price * duration
                  if (p) {
                    setRenewAmount((p.price || 0) * numDur);
                    setRenewDiscount(0);
                  } else {
                    setRenewAmount(0);
                  }
                };

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
                    <select className="form-select" value={renewPlanId} onChange={(e) => handlePlanSelect(e.target.value)}>
                      <option value="" disabled>Select Plan</option>
                      {validRenewalPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      {validRenewalPlans.length === 0 && <option value="" disabled>No valid plans found for this seat type.</option>}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Duration (Months)</label>
                      <NumericInput 
                        className="form-input manual-duration-input" 
                        value={renewDuration} 
                        onChange={(e) => handleDurationChange(e.target.value)} 
                        min={1} 
                        style={{
                          minWidth: '140px',
                          maxWidth: '100%',
                          padding: '10px 14px',
                          fontSize: '16px',
                          fontWeight: 600,
                          borderRadius: '6px'
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Shift</label>
                      <select className="form-select" value={renewShiftId} onChange={(e) => setRenewShiftId(e.target.value)}>
                        <option value="">Linked to Plan</option>
                        {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Method</label>
                      <select
                        className="form-select"
                        value={renewPaymentMethod}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRenewPaymentMethod(val);
                          if (val === 'Split' && renewSplitBreakdown.length < 2) {
                            setRenewSplitBreakdown([
                              { method: 'UPI', amount: '', isManual: false },
                              { method: 'Cash', amount: '', isManual: false }
                            ]);
                          }
                        }}
                      >
                        <option value="">-- Method --</option>
                        <option value="UPI">UPI / QR Code</option>
                        <option value="Cash">Cash</option>
                        <option value="Card">Debit / Credit Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Split">Split Payment</option>
                      </select>
                    </div>
                  </div>
                  {renewPaymentMethod === 'Split' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px', background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
                      <label className="form-label" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Split Breakdown</label>
                      {renewSplitBreakdown.map((item, idx) => {
                        const netPayable = renewAmount - renewDiscount + renewFine;
                        return (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'center' }}>
                            <select
                              className="form-select"
                              value={item.method}
                              onChange={e => {
                                const newB = [...renewSplitBreakdown];
                                newB[idx].method = e.target.value;
                                setRenewSplitBreakdown(newB);
                              }}
                            >
                              <option value="">-- Method --</option>
                              <option value="UPI">UPI / QR Code</option>
                              <option value="Cash">Cash</option>
                              <option value="Card">Debit / Credit Card</option>
                              <option value="Bank Transfer">Bank Transfer</option>
                            </select>
                            <NumericInput
                              className="form-input"
                              value={item.amount}
                              placeholder="Amount ₹"
                              onChange={e => {
                                setRenewSplitBreakdown(prev => handleSplitAmountChange(prev, idx, e.target.value, netPayable));
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setRenewSplitBreakdown(prev => handleRemoveSplitComponent(prev, idx, netPayable));
                              }}
                              style={{ background: 'none', border: 'none', color: 'var(--status-error)', cursor: 'pointer', padding: '4px' }}
                              title="Remove component"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: '11px', padding: '4px', alignSelf: 'flex-start' }}
                        onClick={() => {
                          const netPayable = renewAmount - renewDiscount + renewFine;
                          setRenewSplitBreakdown(prev => handleAddSplitComponent(prev, netPayable));
                        }}
                      >
                        + Add Payment Component
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
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

                  {branches.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Branch</label>
                      <select 
                        className="form-select" 
                        value={relocateBranchId} 
                        onChange={(e) => {
                          setRelocateBranchId(e.target.value);
                          setNewBlockId('');
                          setNewSeatTypeId('');
                          setNewShiftId('');
                          setNewSeatNo('');
                        }} 
                        required
                      >
                        {branches.map(br => (
                          <option key={br.id} value={br.id}>{br.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  <div className="form-group">
                    <label className="form-label">Block / Area</label>
                    <select className="form-select" value={newBlockId} onChange={(e) => { setNewBlockId(e.target.value); setNewSeatTypeId(''); setNewSeatNo(''); }} required>
                      <option value="" disabled>Select Block</option>
                      {sections.filter(s => !relocateBranchId || !s.branchId || s.branchId === relocateBranchId || s.branchId === 'all').map(blk => (
                        <option key={blk.id} value={blk.id}>{blk.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Study Shift</label>
                    <select className="form-select" value={newShiftId} onChange={(e) => { setNewShiftId(e.target.value); setNewSeatNo(''); }} required>
                      <option value="">Select Shift</option>
                      {validRelocateShifts.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">Seat Type</label>
                    <select className="form-select" value={newSeatTypeId} onChange={(e) => { setNewSeatTypeId(e.target.value); setNewSeatNo(''); }} required>
                      <option value="">Select Seat Type</option>
                      {seatTypes.filter(st => st.sectionId === newBlockId).map(st => (
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

      {/* Document Viewer Modal */}
      <AnimatePresence>
        {previewDoc && (
          <motion.div className="modal-overlay" onClick={() => setPreviewDoc(null)} style={{ zIndex: 1100 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" style={{ maxWidth: '640px', padding: '24px' }} onClick={e => e.stopPropagation()} initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>{previewDoc.name} ({previewDoc.fileName})</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => setPreviewDoc(null)} title="Close"><X size={20} /></button>
              </div>
              <div style={{ textAlign: 'center', maxHeight: '65vh', overflowY: 'auto', background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                {previewDoc.dataUrl?.startsWith('data:application/pdf') ? (
                  <embed src={previewDoc.dataUrl} type="application/pdf" width="100%" height="450px" />
                ) : (
                  <img src={previewDoc.dataUrl} alt={previewDoc.name} style={{ maxWidth: '100%', maxHeight: '450px', objectFit: 'contain', borderRadius: '4px' }} />
                )}
              </div>
              <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <a href={previewDoc.dataUrl} download={previewDoc.fileName} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Download size={14} /> Download
                </a>
                <button className="btn btn-primary" onClick={() => setPreviewDoc(null)}>Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Extend Due Date Modal */}
      <AnimatePresence>
        {isExtendModalOpen && selectedStudent && (
          <motion.div className="modal-overlay" onClick={() => setIsExtendModalOpen(false)} style={{ zIndex: 1050 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" style={{ maxWidth: '420px', padding: '24px' }} onClick={e => e.stopPropagation()} initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Extend Due Date</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => setIsExtendModalOpen(false)} title="Close"><X size={20} /></button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!extendDate) return toast.error('Please select an extension date.');
                extendStudentDueDate(selectedStudent.id, extendDate, extendReason);
                setSelectedStudent(prev => ({ ...prev, extendedDueDate: extendDate, extensionReason: extendReason }));
                toast.success(`Due date extended to ${extendDate}`);
                setIsExtendModalOpen(false);
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '10px 12px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                    Student: <strong>{selectedStudent.name}</strong> ({selectedStudent.seatNo})<br />
                    Current Expiry: <strong>{selectedStudent.expiryDate}</strong>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Extended Due Date</label>
                    <input type="date" className="form-input" value={extendDate} min={selectedStudent.expiryDate} onChange={e => setExtendDate(e.target.value)} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Reason for Extension</label>
                    <input type="text" className="form-input" value={extendReason} onChange={e => setExtendReason(e.target.value)} required />
                  </div>
                </div>
                <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setIsExtendModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Extension</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BulkStudentModal
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
      />
      <EditStudentModal
        isOpen={isEditStudentModalOpen}
        onClose={() => setIsEditStudentModalOpen(false)}
        student={selectedStudent}
        onSaveComplete={(updatedStudent) => setSelectedStudent(updatedStudent)}
      />
    </motion.div>
  );
};
