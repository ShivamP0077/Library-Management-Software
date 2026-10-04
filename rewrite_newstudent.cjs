const fs = require('fs');
const path = require('path');

const newStudentModalContent = `import React, { useState, useEffect } from 'react';
import { useLibrary } from '../../context/LibraryContext';
import { X, UserPlus, DollarSign, ShieldAlert, AlertCircle, Clock } from 'lucide-react';
import { NumericInput } from '../NumericInput';

export const NewStudentModal = ({ isOpen, onClose, onPrintReceipt }) => {
  const { 
    settings, branches, sections, plans, shifts, seatTypes, addStudent, students, archivedStudents, 
    todayStr, getAvailableEligibleSeats, resolveScope, canAdmitStudent, addToWaitingList
  } = useLibrary();

  const libId = settings.libraryId;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [gender, setGender] = useState('Male');
  
  // Dynamic Configuration State
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : (branches.length > 0 ? branches[0].id : undefined));
  const [sectionId, setSectionId] = useState(undefined);
  const [planId, setPlanId] = useState('');
  const [seatTypeId, setSeatTypeId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [seatId, setSeatId] = useState('');
  
  const [durationMonths, setDurationMonths] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [amountPaid, setAmountPaid] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [fine, setFine] = useState(0);
  const [internalNotes, setInternalNotes] = useState('');
  
  const [documentFile, setDocumentFile] = useState(null);
  const [submitIdLater, setSubmitIdLater] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  
  const [isFull, setIsFull] = useState(false);
  const [fullReason, setFullReason] = useState('');

  // Dropdown options based on scope
  const branchSections = sections.filter(s => s.branchId === branchId);
  
  const validSeatTypes = seatTypes.filter(st => {
    if (st.libraryId !== libId) return false;
    if (st.branchId && st.branchId !== 'all' && branchId && st.branchId !== branchId) return false;
    if (st.sectionId && sectionId && st.sectionId !== sectionId) return false;
    return true;
  });

  const validShifts = shifts.filter(sh => {
    if (sh.libraryId !== libId) return false;
    if (sh.branchId && sh.branchId !== 'all' && branchId && sh.branchId !== branchId) return false;
    return true;
  });

  const validPlans = plans.filter(p => {
    if (p.libraryId !== libId) return false;
    if (p.branchId && p.branchId !== 'all' && branchId && p.branchId !== branchId) return false;
    if (sectionId && p.blockIds && p.blockIds.length > 0 && !p.blockIds.includes('all') && !p.blockIds.includes(sectionId)) return false;
    if (seatTypeId && p.seatTypeId && p.seatTypeId !== seatTypeId) return false;
    if (shiftId && p.shiftIds && p.shiftIds.length > 0 && !p.shiftIds.includes(shiftId)) return false;
    return true;
  });

  // Automatically select defaults if only 1 option exists
  useEffect(() => {
    if (branches.length === 1 && !branchId) setBranchId(branches[0].id);
    if (branchSections.length === 1 && !sectionId) setSectionId(branchSections[0].id);
  }, [branches, branchSections, branchId, sectionId]);

  // Sync Logic: Plan -> Filters
  useEffect(() => {
    if (planId) {
      const plan = validPlans.find(p => p.id === planId);
      if (plan) {
        if (plan.blockIds && plan.blockIds[0] && plan.blockIds[0] !== 'all') setSectionId(plan.blockIds[0]);
        if (plan.seatTypeId) setSeatTypeId(plan.seatTypeId);
        
        const pShifts = plan.shiftIds || (plan.shiftId ? [plan.shiftId] : []);
        if (pShifts.length > 0 && (!shiftId || !pShifts.includes(shiftId))) {
          setShiftId(pShifts[0]);
        }
        
        setDurationMonths(plan.durationMonths || 1);
        setAmountPaid(plan.price || 0);
      }
    }
  }, [planId, validPlans]);

  // Check Capacity using canAdmitStudent
  useEffect(() => {
    if (seatTypeId && shiftId) {
       const st = seatTypes.find(s => s.id === seatTypeId);
       if (st) {
          const admissionCheck = canAdmitStudent(libId, branchId, sectionId, seatTypeId, shiftId);
          setIsFull(!admissionCheck.allowed);
          setFullReason(admissionCheck.reason || '');
          if (!admissionCheck.allowed) {
             setSeatId('');
          }
       }
    } else {
       setIsFull(false);
       setFullReason('');
    }
  }, [branchId, sectionId, seatTypeId, shiftId, canAdmitStudent, libId, seatTypes]);

  const availableSeats = (!isFull && seatTypeId && shiftId) ? getAvailableEligibleSeats(libId, branchId, sectionId, seatTypeId, shiftId) : [];

  useEffect(() => {
    if (availableSeats.length > 0) {
      if (!seatId || !availableSeats.find(s => s.id === seatId)) {
        setSeatId(availableSeats[0].id);
      }
    } else {
      setSeatId('');
    }
  }, [availableSeats, seatId]);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setName(''); setPhone(''); setEmergencyPhone(''); setGender('Male');
      setPlanId(''); setSectionId(branchSections.length === 1 ? branchSections[0].id : undefined); setSeatTypeId(''); setShiftId(''); setSeatId('');
      setDiscount(0); setFine(0); setInternalNotes(''); setDocumentFile(null); setSubmitIdLater(false);
      setErrors({}); setSubmitError(''); setIsFull(false); setFullReason('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, branchSections.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, name, phone]);

  const handleClose = () => {
    if ((name || phone) && !window.confirm('You have unsaved changes. Are you sure you want to close?')) {
      return;
    }
    onClose();
  };

  const parseNum = (val) => {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  };

  const validateField = (field, value) => {
    let err = '';
    if (field === 'name') {
      if (!/^[A-Za-z\\s]+$/.test(value)) err = 'Name must contain only alphabets and spaces.';
    } else if (field === 'phone' || field === 'emergencyPhone') {
      if (value && !/^\\d{10}$/.test(value)) err = 'Phone must be exactly 10 digits.';
    }
    setErrors(prev => ({ ...prev, [field]: err }));
    return !err;
  };

  const handleWaitlistSubmit = (e) => {
    e.preventDefault();
    setSubmitError('');

    if (!name || !phone || !planId || !shiftId || !seatTypeId) {
      setSubmitError('Please fill in Name, Phone, Plan, Seat Type, and Shift.');
      return;
    }

    if (!validateField('name', name) || !validateField('phone', phone) || (emergencyPhone && !validateField('emergencyPhone', emergencyPhone))) {
      setSubmitError('Please fix the validation errors before submitting.');
      return;
    }

    const waitlistEntry = {
      libraryId: libId,
      studentId: \`wl-stu-\${Date.now()}\`,
      name: name.trim(),
      phone,
      branchId,
      sectionId,
      seatTypeId,
      shiftId,
      planId,
      notes: internalNotes
    };

    addToWaitingList(waitlistEntry);
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitError('');
    
    if (isFull) {
       setSubmitError('Admission is blocked because capacity is full.');
       return;
    }

    const st = seatTypes.find(s => s.id === seatTypeId);
    
    if (!name || !phone || !planId || !shiftId || !seatTypeId || (st?.allocationMode === 'Fixed' && !seatId)) {
      setSubmitError('Please fill in all required fields.');
      return;
    }

    if (!validateField('name', name) || !validateField('phone', phone) || (emergencyPhone && !validateField('emergencyPhone', emergencyPhone))) {
      setSubmitError('Please fix the validation errors before submitting.');
      return;
    }

    const isDuplicate = [...students, ...archivedStudents].some(
      s => s.name.toLowerCase().trim() === name.toLowerCase().trim() && s.phone === phone
    );

    if (isDuplicate) {
      setSubmitError(\`Duplicate Admission Blocked: A student named '\${name}' with phone '\${phone}' already exists.\`);
      return;
    }

    const finalAmount = parseNum(amountPaid);
    const finalDiscount = parseNum(discount);
    const finalFine = parseNum(fine);
    
    const selectedSeatName = (st?.allocationMode === 'Fixed' && seatId) ? availableSeats.find(s => s.id === seatId)?.name : 'Non-Fixed Seat';
    const selectedShift = shifts.find(s => s.id === shiftId);

    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + durationMonths);

    const studentData = {
      libraryId: libId,
      name: name.trim(),
      phone,
      emergencyPhone,
      gender,
      branchId,
      blockId: sectionId, // Legacy mapping
      sectionId,
      planId,
      shiftId,
      shift: selectedShift?.name || 'Full Day',
      seatTypeId,
      seatNo: selectedSeatName,
      amountPaid: finalAmount,
      discount: finalDiscount,
      fine: finalFine,
      paymentMethod,
      internalNotes,
      startDate: startDate.toISOString().split('T')[0],
      expiryDate: expiryDate.toISOString().split('T')[0]
    };

    const result = addStudent(studentData);
    
    if (result && result.student && result.receipt) {
      onPrintReceipt(result.receipt);
      onClose();
    } else {
      setSubmitError('Failed to process admission. Please check seat availability or overlapping shifts.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
              <UserPlus size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>New Admission</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Register a new student</p>
            </div>
          </div>
          <button className="btn-ghost" onClick={handleClose}><X size={20} /></button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {submitError && (
            <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', marginBottom: '24px', display: 'flex', gap: '8px' }}>
              <ShieldAlert size={20} />
              <span style={{ fontSize: '14px', fontWeight: 500 }}>{submitError}</span>
            </div>
          )}
          
          {isFull && (
            <div style={{ padding: '16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#b45309', marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <AlertCircle size={24} style={{ flexShrink: 0 }} />
              <div>
                 <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Admission Full</h4>
                 <p style={{ fontSize: '13px', margin: 0 }}>{fullReason} You cannot admit a student directly to this seat type/shift right now.</p>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Personal Details */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personal Details</h4>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input className={\`form-input \${errors.name ? 'error' : ''}\`} placeholder="e.g. Rahul Sharma" value={name} onChange={e => { setName(e.target.value); validateField('name', e.target.value); }} />
                {errors.name && <span className="error-text" style={{ color: '#ef4444', fontSize: '12px' }}>{errors.name}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Phone Number *</label>
                <input type="tel" className={\`form-input \${errors.phone ? 'error' : ''}\`} placeholder="10-digit mobile number" value={phone} onChange={e => { setPhone(e.target.value); validateField('phone', e.target.value); }} />
                {errors.phone && <span className="error-text" style={{ color: '#ef4444', fontSize: '12px' }}>{errors.phone}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Gender *</label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {['Male', 'Female', 'Other'].map(g => (
                    <label key={g} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="radio" name="gender" value={g} checked={gender === g} onChange={e => setGender(e.target.value)} />
                      <span style={{ fontSize: '14px' }}>{g}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Sync Configuration Engine */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Library Configuration</h4>
              
              <div className="form-group">
                <label className="form-label">Fee Plan (Auto-syncs fields below)</label>
                <select className="form-select" value={planId} onChange={e => setPlanId(e.target.value)}>
                  <option value="">-- Select a Plan --</option>
                  {validPlans.map(p => <option key={p.id} value={p.id}>{p.name} (₹{p.price})</option>)}
                </select>
              </div>
              
              {branches.length > 1 && (
                 <div className="form-group">
                    <label className="form-label">Branch *</label>
                    <select className="form-select" value={branchId || ''} onChange={e => setBranchId(e.target.value)}>
                      <option value="">-- Select Branch --</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                 </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {branchSections.length > 0 && (
                   <div className="form-group">
                     <label className="form-label">Section / Room *</label>
                     <select className="form-select" value={sectionId || ''} onChange={e => setSectionId(e.target.value)}>
                       <option value="">-- Select Section --</option>
                       {branchSections.map(blk => <option key={blk.id} value={blk.id}>{blk.name}</option>)}
                     </select>
                   </div>
                )}
                <div className="form-group" style={{ gridColumn: branchSections.length === 0 ? 'span 2' : 'span 1' }}>
                  <label className="form-label">Seat Type *</label>
                  <select className="form-select" value={seatTypeId} onChange={e => setSeatTypeId(e.target.value)}>
                    <option value="">-- Select Type --</option>
                    {validSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Shift *</label>
                  <select className="form-select" value={shiftId} onChange={e => setShiftId(e.target.value)}>
                    <option value="">-- Select Shift --</option>
                    {validShifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                  </select>
                </div>
                
                {seatTypes.find(st => st.id === seatTypeId)?.allocationMode === 'Fixed' && (
                  <div className="form-group">
                    <label className="form-label">Available Physical Seats *</label>
                    <select className="form-select" value={seatId} onChange={e => setSeatId(e.target.value)} disabled={availableSeats.length === 0 || !shiftId}>
                      {availableSeats.length === 0 && shiftId ? (
                        <option value="" disabled>No available seats</option>
                      ) : (
                        <>
                          <option value="">-- Select Seat --</option>
                          {availableSeats.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </>
                      )}
                    </select>
                  </div>
                )}
              </div>

              {/* Payment Section */}
              {!isFull && (
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '16px' }}>
                  <h5 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>Payment Summary</h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Base Amount</label>
                      <NumericInput className="form-input" value={amountPaid} onChange={e => setAmountPaid(Number(e.target.value))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Discount</label>
                      <NumericInput className="form-input" value={discount} onChange={e => setDiscount(Number(e.target.value))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500 }}>Net Total</span>
                    <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--brand-primary)' }}>₹{(parseNum(amountPaid) - parseNum(discount) + parseNum(fine)).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-light)', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
          <div>
            {isFull && (
               <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={handleWaitlistSubmit}>
                 <Clock size={16} /> Add to Waiting List
               </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-ghost" onClick={handleClose}>Cancel</button>
            {!isFull && <button className="btn btn-primary" onClick={handleSubmit}>Complete Admission</button>}
          </div>
        </div>
      </div>
    </div>
  );
};
`;

fs.writeFileSync(path.join(__dirname, 'src/components/Modals/NewStudentModal.jsx'), newStudentModalContent, 'utf8');
console.log('NewStudentModal updated successfully.');
