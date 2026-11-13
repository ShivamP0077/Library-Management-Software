import { DocPreview } from '../DocPreview';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLibrary } from '../../context/LibraryContext';
import { X, UserPlus, ShieldAlert, AlertCircle, Clock, Check, RefreshCw } from 'lucide-react';
import { NumericInput } from '../NumericInput';
import toast from 'react-hot-toast';
import { calculatePricing } from '../../utils/pricingCalculator';
import { handleSplitAmountChange, handleAddSplitComponent, handleRemoveSplitComponent, validateSplitPayment } from '../../utils/splitPaymentUtils';
import { paymentReferenceError } from '../../utils/paymentReference';
import { ReferenceField } from '../ReferenceField';
import { periodEndDate, validatePaidOn } from '../../utils/dateUtils';
import { effectiveCycleConfig, firstAdmissionCharge, addDays } from '../../utils/billingCycle';
import { saveDocumentBlobNow, deleteDocumentBlob, getDocumentBlob } from '../../utils/idbStorage';
import { api } from '../../utils/api';
import { uploadAttachmentFile, makeAttachmentKey } from '../../utils/attachmentUpload';
import { allDocumentFiles, addFilesToDocuments, removeDocumentFile } from '../../utils/studentDocuments';

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

import { getCanonicalShifts, isShiftInPlan } from '../../utils/shiftUtils';
import { clientCanEditAmount } from '../../utils/amountPermission';
import { getCanonicalSeatTypes, areSeatTypesEquivalent } from '../../utils/seatTypeUtils';

export const NewStudentModal = ({ isOpen, onClose, onPrintReceipt, waitlistPayload, onAdmitted }) => {
  const { 
    settings, branches, sections, plans, shifts, seatTypes, addStudent, students, archivedStudents, 
    todayStr, getAvailableEligibleSeats, canAdmitStudent, addToWaitingList, getMatchingPlans, getUnsyncedShifts, getUnsyncedPlans,
    currentStaff, lockedStaffId
  } = useLibrary();
  const canEditAmount = clientCanEditAmount({ lockedStaffId, currentStaff, settings });

  const libId = settings.libraryId;

  // Flow toggle: 'plan-first' | 'seat-first'
  const [admissionFlow, setAdmissionFlow] = useState('plan-first');

  // Personal Info
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [gender, setGender] = useState('Male');
  const [internalNotes, setInternalNotes] = useState('');

  // Document Requirement State
  const [selectedDocType, setSelectedDocType] = useState(settings.allowedDocuments?.[0] || 'Aadhaar Card');
  // Issue #3: one group per document type, each with an additive files[] list.
  const [docGroups, setDocGroups] = useState([]);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitDocLater, setSubmitDocLater] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const lastSourceRef = useRef('upload'); // which picker was used, for Retake
  const [previewUrls, setPreviewUrls] = useState({});
  const [previewDoc, setPreviewDoc] = useState(null);
  const [isDocPreviewOpen, setIsDocPreviewOpen] = useState(false);
  const docFiles = useMemo(() => allDocumentFiles(docGroups), [docGroups]);
  const docFileAttached = docFiles.length > 0;

  const selectedDocTypeObj = settings.documentTypes?.find(d => d.name === selectedDocType);
  const effectiveDocRequirement = selectedDocTypeObj?.requirement || settings.idProofRequirement || 'Required';
  const canSkipDocument = effectiveDocRequirement === 'Can Be Submitted Later';

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    lastSourceRef.current = e.target === cameraInputRef.current ? 'camera' : 'upload';
    resetFileInput();

    // Cancelling the picker (or selecting nothing) must never mark a document as attached.
    if (!files.length) return;

    setIsUploadingDoc(true);
    setUploadProgress(0);
    const added = [];
    const urls = {};
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const storageKey = makeAttachmentKey('doc', `${libId}_${selectedDocType}_${Date.now()}_${i}_${Math.random()}`);
      try {
        const meta = await uploadAttachmentFile({
          file,
          key: storageKey,
          returnDataUrl: true,
          onProgress: (p) => setUploadProgress(Math.round(((i + p / 100) / files.length) * 100)),
          save: (key, data) => saveDocumentBlobNow(key, data, {
            docTypeId: selectedDocType,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            status: 'Submitted',
          }),
        });
        added.push({ ...meta, name: selectedDocType, docTypeId: selectedDocType, status: 'Submitted' });
        if (meta.dataUrl) urls[meta.id] = meta.dataUrl;
        delete meta.dataUrl;
      } catch (err) {
        toast.error(err?.message || `Could not attach ${file.name}.`);
      }
    }
    if (added.length) {
      setDocGroups(prev => addFilesToDocuments(prev, { name: selectedDocType, docTypeId: selectedDocType, files: added }));
      setPreviewUrls(prev => ({ ...prev, ...urls }));
      setSubmitDocLater(false);
      toast.success(added.length === 1 ? `Attached ${added[0].fileName}` : `Attached ${added.length} files`);
    }
    setIsUploadingDoc(false);
    setUploadProgress(0);
  };

  const handleRemoveDoc = (docKey, fileId) => {
    setDocGroups(prev => removeDocumentFile(prev, docKey, fileId));
    setPreviewUrls(prev => { const next = { ...prev }; delete next[fileId]; return next; });
    if (previewDoc?.id === fileId) { setIsDocPreviewOpen(false); setPreviewDoc(null); }
    if (fileId) deleteDocumentBlob(fileId).catch(() => {});
  };

  const openDocPreview = async (file, docTypeId) => {
    let url = previewUrls[file.id];
    if (!url) {
      const stored = await getDocumentBlob(file.storageKey);
      url = typeof stored === 'string' ? stored : (stored ? URL.createObjectURL(stored) : null);
      if (url) setPreviewUrls(prev => ({ ...prev, [file.id]: url }));
    }
    if (!url) { toast.error('Could not load this preview. Re-attach the file if needed.'); return; }
    setPreviewDoc({ ...file, docTypeId: docTypeId || file.docTypeId, url });
    setIsDocPreviewOpen(true);
  };

  // Hierarchy Selection
  const [branchId, setBranchId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [seatTypeId, setSeatTypeId] = useState('');
  const [planId, setPlanId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [seatNo, setSeatNo] = useState('');
  const [durationMonths, setDurationMonths] = useState(1);
  const [isManualDuration, setIsManualDuration] = useState(false);

  // Transaction-Level Pricing & Discount Overrides
  const [baseAmount, setBaseAmountRaw] = useState(0);
  // Issue #9: remember the system amount so a manual change can be flagged (server checks permission + audits).
  const [suggestedBase, setSuggestedBase] = useState(0);
  const [proRateApplied, setProRateApplied] = useState(null);
  const setBaseAmount = (v) => { setBaseAmountRaw(v); setSuggestedBase(v); setProRateApplied(null); };
  const [discountType, setDiscountType] = useState('None'); // 'None' | 'Percentage' | 'Fixed'
  const [discountValue, setDiscountValue] = useState(0);
  const [fine, setFine] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [splitBreakdown, setSplitBreakdown] = useState([{ method: '', amount: '' }]);
  const [paidOn, setPaidOn] = useState(todayStr);
  const [joiningDate, setJoiningDate] = useState(todayStr);

  // Error & Status State
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isCapacityFull, setIsCapacityFull] = useState(false);
  const [capacityReason, setCapacityReason] = useState('');

  // Unsynced IDs
  const unsyncedShifts = useMemo(() => getUnsyncedShifts().map(s => s.id), [getUnsyncedShifts]);
  const unsyncedPlans = useMemo(() => getUnsyncedPlans().map(p => p.id), [getUnsyncedPlans]);

  // Valid Active Shifts & Plans (filtering out broken/unsynced configurations)
  const validShifts = useMemo(() => {
    const raw = shifts.filter(sh => {
      if (sh.active === false) return false;
      if (unsyncedShifts.includes(sh.id)) return false;
      if (branchId && branchId !== 'all' && sh.branchId && sh.branchId !== 'all' && sh.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && sh.sectionId && sh.sectionId !== 'all' && sh.sectionId !== sectionId) return false;
      return true;
    });
    return getCanonicalShifts(raw);
  }, [shifts, unsyncedShifts, branchId, sectionId]);

  const validPlans = useMemo(() => {
    return plans.filter(p => {
      if (p.active === false) return false;
      // DO NOT STRICTLY REMOVE "UNSYNCED" PLANS IF THEY ARE MANUALLY CREATED
      // Just check scope match
      if (branchId && branchId !== 'all' && p.branchId && p.branchId !== 'all' && p.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && p.sectionId && p.sectionId !== 'all' && p.sectionId !== sectionId) return false;
      
      // In plan-first flow, show all plans for the branch/section. Selecting a plan auto-updates the seat type.
      if (admissionFlow === 'seat-first') {
        if (seatTypeId && p.seatTypeId && p.seatTypeId !== seatTypeId && !areSeatTypesEquivalent(seatTypes, p.seatTypeId, seatTypeId)) return false;
      }
      
      if (shiftId) {
        if (!isShiftInPlan(shifts, p, shiftId)) return false;
      }
      return true;
    });
  }, [plans, shifts, seatTypes, branchId, sectionId, seatTypeId, shiftId, admissionFlow]);

  const branchSections = useMemo(() => {
    return sections.filter(s => !branchId || branchId === 'all' || !s.branchId || s.branchId === branchId);
  }, [sections, branchId]);

  const validSeatTypes = useMemo(() => {
    const scoped = seatTypes.filter(st => {
      if (branchId && branchId !== 'all' && st.branchId && st.branchId !== 'all' && st.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && st.sectionId && st.sectionId !== 'all' && st.sectionId !== sectionId) return false;
      return true;
    });
    return getCanonicalSeatTypes(scoped);
  }, [seatTypes, branchId, sectionId]);

  // Reset form ONLY when modal opens or waitlistPayload changes (do not depend on validSeatTypes/branches)
  useEffect(() => {
    if (isOpen) {
      setName(''); setPhone(''); setEmergencyPhone(''); setGender('Male');
      setInternalNotes(waitlistPayload?.email ? `Enquiry email: ${waitlistPayload.email}` : '');
      setSubmitError(''); setIsCapacityFull(false);
      setDocGroups([]); setPreviewUrls({}); setPreviewDoc(null); setIsDocPreviewOpen(false);
      setIsUploadingDoc(false); setUploadProgress(0); setSubmitDocLater(false);
      resetFileInput();
      
      const defaultB = branches[0]?.id || '';
      const defaultS = sections.find(s => !defaultB || s.branchId === defaultB)?.id || '';
      
      if (waitlistPayload) {
        setName(waitlistPayload.name || '');
        setPhone(waitlistPayload.phone || '');
        setBranchId(waitlistPayload.branchId || defaultB);
        setSectionId(waitlistPayload.sectionId || defaultS);
        setSeatTypeId(waitlistPayload.seatTypeId || '');
        setShiftId(waitlistPayload.shiftId || '');
        setSeatNo('');
        setPlanId(waitlistPayload.planId || '');
      } else {
        setBranchId(defaultB);
        setSectionId(defaultS);
        setSeatTypeId('');
        setSeatNo('');
        setPlanId('');
        setShiftId('');
        setPaymentMethod('');
        setReferenceNo('');
        setSplitBreakdown([{ method: '', amount: '' }]);
        setPaidOn(todayStr);
        setJoiningDate(todayStr);
      }
      setDurationMonths(1); setIsManualDuration(false); setDiscountType('None'); setDiscountValue(0); setFine(0);
      setPaidOn(todayStr); setJoiningDate(todayStr);
    }
  }, [isOpen, waitlistPayload]);

  // When branchId changes, adapt section, seatType, and plan cleanly without resetting branch
  const prevBranchRef = React.useRef(branchId);
  useEffect(() => {
    if (prevBranchRef.current !== branchId) {
      prevBranchRef.current = branchId;
      const validSecs = sections.filter(s => !branchId || branchId === 'all' || !s.branchId || s.branchId === branchId);
      if (!validSecs.some(s => s.id === sectionId)) {
        setSectionId(validSecs[0]?.id || '');
      }
      setSeatNo('');
      setPlanId('');
    }
  }, [branchId, sections, sectionId]);

  // Auto-sync seatTypeId with validSeatTypes
  useEffect(() => {
    if (validSeatTypes.length > 0) {
      if (!seatTypeId || !validSeatTypes.some(st => st.id === seatTypeId || areSeatTypesEquivalent(seatTypes, st.id, seatTypeId))) {
        setSeatTypeId(validSeatTypes[0].id);
      }
    } else {
      setSeatTypeId('');
    }
  }, [validSeatTypes, seatTypeId, seatTypes]);

  // Progressive Defaults: if only 1 branch or 1 section, auto-select
  useEffect(() => {
    if (branches.length === 1 && !branchId) setBranchId(branches[0].id);
    if (branchSections.length === 1 && !sectionId) setSectionId(branchSections[0].id);
  }, [branches, branchSections, branchId, sectionId]);

  // FLOW A: SEAT-FIRST -> When vacant seat & shift selected, auto-match valid plan
  useEffect(() => {
    if (admissionFlow === 'seat-first' && seatTypeId && shiftId) {
      const matching = getMatchingPlans(libId, branchId, sectionId, seatTypeId, shiftId);
      if (matching.length > 0) {
        if (matching.length === 1 || !matching.some(p => p.id === planId)) {
          setPlanId(matching[0].id);
        }
      }
    }
  }, [admissionFlow, seatTypeId, shiftId, branchId, sectionId, libId, getMatchingPlans, planId]);

  // When Plan is selected, auto-select its first applicable shift if current shift is not applicable
  useEffect(() => {
    if (planId) {
      const selectedPlan = plans.find(p => p.id === planId);
      if (selectedPlan) {
        if (selectedPlan.seatTypeId) setSeatTypeId(selectedPlan.seatTypeId);
        if (selectedPlan.sectionId) setSectionId(selectedPlan.sectionId);

        const applicableShifts = validShifts.filter(sh => isShiftInPlan(shifts, selectedPlan, sh.id));
        if (applicableShifts.length > 0) {
          if (!shiftId || !isShiftInPlan(shifts, selectedPlan, shiftId)) {
            setShiftId(applicableShifts[0].id);
          }
        }

        // Auto-select duration from plan pricing
        const pricing = selectedPlan.durationPricing || [];
        if (pricing.length > 0) {
          const matchPrice = pricing.find(dp => dp.durationMonths === durationMonths) || pricing[0];
          setDurationMonths(matchPrice.durationMonths);
          setBaseAmount(matchPrice.basePrice);
          setDiscountType(matchPrice.discountType || 'None');
          setDiscountValue(matchPrice.discountValue || 0);
        }
      }
    }
  }, [planId, plans, validShifts]);

  // When Duration is changed for current Plan, recalculate basePrice and discount
  const handleDurationChange = (dur) => {
    setDurationMonths(dur);
    const selectedPlan = plans.find(p => p.id === planId);
    const numDur = dur === '' ? 1 : Math.max(1, Number(dur) || 1);

    if (selectedPlan && selectedPlan.durationPricing && selectedPlan.durationPricing.length > 0) {
      const match = selectedPlan.durationPricing.find(dp => dp.durationMonths === numDur);
      if (match) {
        setBaseAmount(match.basePrice);
        setDiscountType(match.discountType || 'None');
        setDiscountValue(match.discountValue || 0);
      } else {
        const oneMonth = selectedPlan.durationPricing.find(d => d.durationMonths === 1);
        const unitPrice = oneMonth ? Number(oneMonth.basePrice) : (Number(selectedPlan.durationPricing[0].basePrice) / Number(selectedPlan.durationPricing[0].durationMonths));
        setBaseAmount(unitPrice * numDur);
      }
    } else if (selectedPlan) {
      const unitPrice = selectedPlan.price ? Number(selectedPlan.price) : 0;
      setBaseAmount(unitPrice * numDur);
    } else {
      setBaseAmount(0);
    }
  };

  // Capacity & Physical Seat Availability Check
  const currentSeatType = seatTypes.find(st => st.id === seatTypeId);
  const isFixed = currentSeatType?.allocationMode === 'Fixed';

  useEffect(() => {
    if (seatTypeId && shiftId) {
      const check = canAdmitStudent(libId, branchId, sectionId, seatTypeId, shiftId, isFixed ? seatNo : null);
      setIsCapacityFull(!check.allowed);
      setCapacityReason(check.reason || '');
    } else {
      setIsCapacityFull(false);
      setCapacityReason('');
    }
  }, [libId, branchId, sectionId, seatTypeId, shiftId, seatNo, isFixed, canAdmitStudent]);

  // Eligible & Available Seats for Fixed Desk
  const availableDesks = useMemo(() => {
    if (!isFixed || !shiftId) return [];
    return getAvailableEligibleSeats(libId, branchId, sectionId, seatTypeId, shiftId);
  }, [isFixed, shiftId, libId, branchId, sectionId, seatTypeId, getAvailableEligibleSeats]);

  // Auto-pick first available desk in Plan-first flow
  useEffect(() => {
    if (isFixed && availableDesks.length > 0 && (!seatNo || !availableDesks.some(s => (s.name || s.seatNumber) === seatNo))) {
      setSeatNo(availableDesks[0].name || availableDesks[0].seatNumber);
    } else if (isFixed && availableDesks.length === 0) {
      setSeatNo('');
    }
  }, [isFixed, availableDesks, seatNo]);

  // Price Calculation: Base - Applied Discount + Fine
  const { calculatedDiscount, netTotal: netPayable } = useMemo(() => {
    const selectedPlan = plans.find(p => p.id === planId);
    return calculatePricing({
      plan: selectedPlan,
      durationMonths: Number(durationMonths || 1),
      isManualDuration,
      manualBasePrice: Number(baseAmount || 0),
      userDiscountType: discountType,
      userDiscountValue: Number(discountValue || 0),
      transactionFine: Number(fine || 0)
    });
  }, [baseAmount, discountType, discountValue, fine, planId, plans, durationMonths, isManualDuration]);

  // Form Validation
  const validate = () => {
    const errs = {};
    if (!name.trim()) errs.name = "Student name is required.";
    if (!/^\d{10}$/.test(phone)) errs.phone = "Phone must be exactly 10 digits.";
    if (emergencyPhone && !/^\d{10}$/.test(emergencyPhone)) errs.emergencyPhone = "Emergency phone must be 10 digits.";
    if (!seatTypeId) errs.seatTypeId = "Please select a seat type.";
    if (!shiftId) errs.shiftId = "Please select an operating shift.";
    if (!planId) errs.planId = "Please select a fee plan.";
    const parsedDur = Number(durationMonths);
    if (!parsedDur || parsedDur < 1) errs.durationMonths = "Valid Subscription Duration (>= 1) is required.";
    if (isFixed && !seatNo) errs.seatNo = "Physical seat allocation is required for Fixed desks.";
    const paidOnError = validatePaidOn(paidOn, todayStr);
    if (paidOnError) errs.paidOn = paidOnError;
    if (!joiningDate) errs.joiningDate = "Enter the period start date.";
    else if (joiningDate > todayStr) errs.joiningDate = "Period start cannot be in the future.";
    if (!paymentMethod) errs.paymentMethod = "Please select a payment method.";
    if (paymentMethod === 'Split') {
      const splitCheck = validateSplitPayment(splitBreakdown, netPayable);
      if (!splitCheck.valid) {
        errs.splitAmount = splitCheck.error;
      }
    }
    const referenceErr = paymentReferenceError({
      method: paymentMethod,
      referenceNo,
      breakdown: paymentMethod === 'Split' ? splitBreakdown : undefined,
    });
    if (referenceErr) errs.referenceNo = referenceErr;

    // Document requirement validation
    if (effectiveDocRequirement === 'Required' && !docFileAttached && !submitDocLater) {
      errs.document = `Admission document (${selectedDocType}) is required.`;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleWaitlistSubmit = () => {
    if (!name.trim() || !phone) {
      toast.error('Name and Phone are required for waiting list.');
      return;
    }
    addToWaitingList({
      libraryId: libId,
      name: name.trim(),
      phone,
      branchId: branchId || undefined,
      sectionId: sectionId || undefined,
      seatTypeId,
      shiftId,
      planId,
      notes: internalNotes || "Added from New Admission when capacity full."
    });
    toast.success(`Student "${name}" added to Waiting List.`);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    if (isCapacityFull) {
      setSubmitError(capacityReason || 'Capacity is full.');
      return;
    }

    const todayFormatted = joiningDate || todayStr;
    const anchorDay = Number(String(todayFormatted).slice(8, 10)) || undefined;
    const admissionPlan = plans.find(p => p.id === planId);
    const admissionCycle = effectiveCycleConfig(settings, admissionPlan);
    // Plans with no duration type keep the previous month-based expiry. Pro-rate still follows the library cycle.
    let calculatedExpiry = admissionPlan?.billingCycle?.mode
      ? periodEndDate(todayFormatted, durationMonths || 1, { anchorDay, cycle: admissionCycle })
      : periodEndDate(todayFormatted, durationMonths || 1, { anchorDay });
    let proRatedPayload = null;
    if (proRateApplied) {
      const unit = Number(suggestedBase) / Math.max(1, Number(durationMonths) || 1);
      const pr = firstAdmissionCharge(unit, todayFormatted, admissionCycle);
      calculatedExpiry = pr.to;
      proRatedPayload = { ...pr, fullFee: Number(suggestedBase) };
    }

    const docRecords = docGroups.map((group) => {
      const files = (group.files || []).map(({ dataUrl: _u, ...f }) => ({ ...f, name: group.name, docTypeId: group.docTypeId }));
      const first = files[0] || {};
      return {
        name: group.name,
        docTypeId: group.docTypeId,
        files,
        storageKey: first.storageKey || null,
        fileName: first.fileName || null,
        fileType: first.fileType || '',
        fileSize: first.fileSize ?? null,
        uploadedAt: first.uploadedAt || new Date().toISOString(),
        status: first.status || 'Submitted',
      };
    });

    const studentData = {
      name: name.trim(),
      phone,
      emergencyPhone,
      gender,
      branchId: branchId || undefined,
      sectionId: sectionId || undefined,
      seatTypeId,
      planId,
      shiftId,
      shift: shifts.find(s => s.id === shiftId)?.name || 'Full Day',
      seatNo: isFixed ? seatNo : 'Non-Fixed Seat',
      durationMonths: Number(durationMonths),
      amountPaid: proRatedPayload ? proRatedPayload.amount : Number(baseAmount),
      suggestedAmount: proRatedPayload ? proRatedPayload.amount : Number(suggestedBase),
      ...(!proRatedPayload && Number(baseAmount) !== Number(suggestedBase) ? { amountEdited: true } : {}),
      ...(proRatedPayload ? { proRated: proRatedPayload } : {}),
      paidOn,
      discount: calculatedDiscount,
      fine: Number(fine),
      paymentMethod,
      referenceNo,
      breakdown: paymentMethod === 'Split' ? splitBreakdown : undefined,
      internalNotes,
      documents: docRecords,
      idProofStatus: submitDocLater ? 'Pending' : (docRecords.length ? 'Verified' : 'Not Required'),
      startDate: todayFormatted,
      expiryDate: calculatedExpiry
    };

    const res = addStudent(studentData);
    if (res && res.student) {
      // Claim the already-uploaded files for this student so a student-scoped fetch can verify ownership.
      await Promise.all(docFiles.map((f) => api.updateDocumentMeta(f.storageKey, { studentId: res.student.id }).catch(() => {})));
      if (waitlistPayload?.enquiryId && onAdmitted) {
        try {
          await onAdmitted(waitlistPayload.enquiryId);
        } catch (err) {
          toast.error(err?.message || 'Admission saved, but the enquiry is still on the waiting list.');
        }
      }
      toast.success('Student admission completed successfully!');
      if (onPrintReceipt && res.receipt) {
        onPrintReceipt(res.receipt);
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '840px', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-primary)' }}>
              <UserPlus size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 700 }}>New Student Admission</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Two-Way Admission Flow with Live Matching</p>
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '72vh', overflowY: 'auto' }}>
          {submitError && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '13px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <ShieldAlert size={16} /> <span>{submitError}</span>
            </div>
          )}

          {/* Admission Flow Toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>ADMISSION MODE</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className={`btn ${admissionFlow === 'plan-first' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '12px', padding: '4px 12px' }}
                onClick={() => setAdmissionFlow('plan-first')}
              >
                Plan-First Flow
              </button>
              <button
                type="button"
                className={`btn ${admissionFlow === 'seat-first' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '12px', padding: '4px 12px' }}
                onClick={() => setAdmissionFlow('seat-first')}
              >
                Seat-First Flow
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px' }}>
            {/* Left Column: Personal & Documents */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                1. Student Details
              </h4>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px' }}>Full Name *</label>
                <input className={`form-input ${errors.name ? 'error' : ''}`} placeholder="e.g. Rahul Sharma" value={name} onChange={e => setName(e.target.value)} />
                {errors.name && <span style={{ color: '#ef4444', fontSize: '11px' }}>{errors.name}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Phone Number *</label>
                  <input type="tel" maxLength={10} className={`form-input ${errors.phone ? 'error' : ''}`} placeholder="10 Digits" value={phone} onChange={e => setPhone(e.target.value)} />
                  {errors.phone && <span style={{ color: '#ef4444', fontSize: '11px' }}>{errors.phone}</span>}
                  {waitlistPayload?.email && <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Email: {waitlistPayload.email}</span>}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Emergency Phone</label>
                  <input type="tel" maxLength={10} className="form-input" placeholder="Optional" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px' }}>Gender *</label>
                <div className="radio-group" role="radiogroup" aria-label="Gender">
                  {['Male', 'Female', 'Other'].map(g => (
                    <label key={g}>
                      <input type="radio" name="gnd" value={g} checked={gender === g} onChange={() => setGender(g)} />
                      <span>{g}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Document Verification Section */}
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>ID Document Verification</span>
                  <span style={{ fontSize: '10px', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px' }}>
                    {effectiveDocRequirement}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select className="form-select" style={{ fontSize: '12px', flex: 1 }} value={selectedDocType} onChange={e => setSelectedDocType(e.target.value)}>
                    {(settings.allowedDocuments || ["Aadhaar Card", "Student ID", "Address Proof"]).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '12px', border: '1px solid var(--border-light)', cursor: isUploadingDoc ? 'not-allowed' : 'pointer', opacity: isUploadingDoc ? 0.6 : 1, flexShrink: 0 }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingDoc}
                  >
                    {isUploadingDoc ? 'Attaching...' : (docFileAttached ? 'Replace' : 'Attach')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '12px', border: '1px solid var(--border-light)', cursor: isUploadingDoc ? 'not-allowed' : 'pointer', opacity: isUploadingDoc ? 0.6 : 1, flexShrink: 0 }}
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isUploadingDoc}
                    aria-label="Take photo with camera"
                  >
                    Camera
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                    disabled={isUploadingDoc}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    disabled={isUploadingDoc}
                    data-testid="doc-camera-input"
                  />
                </div>

                {isUploadingDoc && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ height: 4, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#2563eb', transition: 'width .2s ease' }} />
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Uploading… {uploadProgress}%</span>
                  </div>
                )}

                {!docFileAttached && !isUploadingDoc && (
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '8px' }}>No file selected</span>
                )}

                {docGroups.map((group) => (
                  <div key={group.docTypeId || group.name} style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>{group.name} <span style={{ fontWeight: 400 }}>({group.files.length})</span></div>
                    {group.files.map((file) => (
                      <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderTop: '1px dashed var(--border-light)' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: '11px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.fileName}>
                          {file.fileName}{file.fileSize ? ` (${formatFileSize(file.fileSize)})` : ''}
                        </span>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => openDocPreview(file, group.docTypeId || group.name)}>Preview</button>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--status-error)' }} onClick={() => handleRemoveDoc(group.docTypeId || group.name, file.id)}>Remove</button>
                      </div>
                    ))}
                  </div>
                ))}

                {canSkipDocument && !docFileAttached && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginTop: '8px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={submitDocLater} onChange={e => setSubmitDocLater(e.target.checked)} />
                    <span>Skip for now (mark document pending)</span>
                  </label>
                )}
                {errors.document && <span style={{ color: '#ef4444', fontSize: '11px', display: 'block', marginTop: '4px' }}>{errors.document}</span>}
                {isDocPreviewOpen && previewDoc && (
                  <DocPreview
                    src={previewDoc.url}
                    name={`${previewDoc.docTypeId || selectedDocType}: ${previewDoc.fileName}`}
                    fileType={previewDoc.fileType}
                    onClose={() => setIsDocPreviewOpen(false)}
                    onRemove={() => handleRemoveDoc(previewDoc.docTypeId, previewDoc.id)}
                    onRetake={() => { setIsDocPreviewOpen(false); (lastSourceRef.current === 'camera' ? cameraInputRef : fileInputRef).current?.click(); }}
                  />
                )}
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px' }}>Internal Notes</label>
                <input className="form-input" placeholder="e.g. Preparing for exams, prefers quiet corner" value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
              </div>
            </div>

            {/* Right Column: Library Configuration Engine */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                2. Seat & Plan Matching
              </h4>

              {/* Progressive Hierarchy Selectors */}
              {branches.length > 1 && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Branch</label>
                  <select className="form-select" value={branchId} onChange={e => setBranchId(e.target.value)}>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: branchSections.length > 1 ? '1fr 1fr' : '1fr', gap: '10px' }}>
                {branchSections.length > 1 && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Section</label>
                    <select className="form-select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
                      <option value="">All Sections</option>
                      {branchSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Seat Type *</label>
                  <select className="form-select" value={seatTypeId} onChange={e => setSeatTypeId(e.target.value)}>
                    {validSeatTypes.map(st => (
                      <option key={st.id} value={st.id}>{st.name} ({st.allocationMode})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Flow specific ordering */}
              {admissionFlow === 'plan-first' ? (
                <>
                  {/* Plan first */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Fee Plan *</label>
                    <select className="form-select" value={planId} onChange={e => setPlanId(e.target.value)}>
                      <option value="">-- Select Plan --</option>
                      {validPlans.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {errors.planId && <span style={{ color: '#ef4444', fontSize: '11px' }}>{errors.planId}</span>}
                  </div>

                  {/* Shift Selection (Dynamic: only compatible shifts for chosen plan) */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Operating Shift *</label>
                    <select className="form-select" value={shiftId} onChange={e => setShiftId(e.target.value)}>
                      <option value="">-- Select Shift --</option>
                      {validShifts.filter(sh => {
                        const currentPlan = plans.find(p => p.id === planId);
                        return !currentPlan || currentPlan.shiftIds?.includes(sh.id);
                      }).map(sh => (
                        <option key={sh.id} value={sh.id}>{sh.name}</option>
                      ))}
                    </select>
                    {errors.shiftId && <span style={{ color: '#ef4444', fontSize: '11px' }}>{errors.shiftId}</span>}
                  </div>

                  {/* Physical Seat Selection for Fixed */}
                  {isFixed && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Physical Desk ({availableDesks.length} Available) *</span>
                        {availableDesks.length > 0 && (
                           <button 
                             type="button" 
                             style={{ background: '#dbeafe', border: 'none', padding: '2px 6px', borderRadius: '4px', color: '#2563eb', fontSize: '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                             onClick={() => setSeatNo(availableDesks[0].name || availableDesks[0].seatNumber)}
                           >
                             ⚡ Auto-assign
                           </button>
                        )}
                      </label>
                      <select 
                        className="form-select" 
                        value={seatNo} 
                        onChange={e => setSeatNo(e.target.value)}
                        disabled={availableDesks.length === 0}
                      >
                        {availableDesks.length === 0 ? (
                          <option value="">No vacant desks for this shift</option>
                        ) : (
                          availableDesks.map(s => <option key={s.id} value={s.name || s.seatNumber}>{s.name || s.seatNumber}</option>)
                        )}
                      </select>
                      {errors.seatNo && <span style={{ color: '#ef4444', fontSize: '11px' }}>{errors.seatNo}</span>}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Seat-first: Physical Seat -> Shift -> Auto-matched Plan */}
                  {isFixed && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '12px' }}>Select Physical Desk *</label>
                      <select className="form-select" value={seatNo} onChange={e => setSeatNo(e.target.value)}>
                        {availableDesks.map(s => <option key={s.id} value={s.name || s.seatNumber}>{s.name || s.seatNumber}</option>)}
                      </select>
                    </div>
                  )}

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Select Shift *</label>
                    <select className="form-select" value={shiftId} onChange={e => setShiftId(e.target.value)}>
                      <option value="">-- Select Shift --</option>
                      {validShifts.map(sh => (
                        <option key={sh.id} value={sh.id}>{sh.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Auto-Matched Fee Plan *</label>
                    <select className="form-select" value={planId} onChange={e => setPlanId(e.target.value)}>
                      <option value="">-- Select Plan --</option>
                      {validPlans.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Subscription Duration Selection */}
              {planId && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Subscription Duration</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label htmlFor="duration-months-input" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Months:
                    </label>
                    <input
                      id="duration-months-input"
                      type="number"
                      min="1"
                      step="1"
                      className={`form-input ${errors.durationMonths ? 'error' : ''}`}
                      value={durationMonths}
                      onChange={(e) => handleDurationChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          const val = Math.max(1, (Number(durationMonths) || 0) + 1);
                          handleDurationChange(val);
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          const val = Math.max(1, (Number(durationMonths) || 1) - 1);
                          handleDurationChange(val);
                        }
                      }}
                      onBlur={() => {
                        const val = Number(durationMonths);
                        if (!val || val < 1) handleDurationChange(1);
                      }}
                      style={{
                        width: '120px',
                        padding: '8px 12px',
                        fontSize: '15px',
                        fontWeight: 600,
                        borderRadius: '6px'
                      }}
                    />
                  </div>
                  {errors.durationMonths && <span style={{ color: '#ef4444', fontSize: '11px', display: 'block', marginTop: '4px' }}>{errors.durationMonths}</span>}
                </div>
              )}

              {/* Capacity Full Alert Area */}
              {isCapacityFull && (
                <div style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#b45309' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: '12px' }}>
                      <strong>Capacity Full / No Physical Desks:</strong> {capacityReason}
                      <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        <button type="button" className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={handleWaitlistSubmit}>
                          <Clock size={12} /> Add to Waiting List
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Transaction Pricing & Discount Override Box */}
              {!isCapacityFull && planId && (
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>FEE & DISCOUNT</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Overrides apply to this admission only</span>
                  </div>
                  {(() => {
                    const selected = plans.find(p => p.id === planId);
                    const cfg = effectiveCycleConfig(settings, selected);
                    if (cfg.mode === 'ANNIVERSARY' || !selected || Number(durationMonths) !== 1) return null;
                    const unit = Number(suggestedBase) / Math.max(1, Number(durationMonths) || 1);
                    const pr = firstAdmissionCharge(unit, joiningDate || todayStr, cfg);
                    if (!pr.prorated) return null;
                    return (
                      <div data-testid="prorate-box" style={{ fontSize: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span>{selected.billingCycle?.mode ? 'This plan' : 'Library cycle'}: first payment ₹{pr.amount.toLocaleString()} for {pr.days} of {pr.totalDays} days (to {pr.to}). Then full fee.</span>
                        {proRateApplied ? (
                          <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setBaseAmount(Number(suggestedBase))}>Use full fee</button>
                        ) : (
                          <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => { setBaseAmountRaw(pr.amount); setProRateApplied({ ...pr, fullFee: Number(suggestedBase) }); }}>Use pro-rated</button>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '11px' }}>Base Price (₹)</label>
                      <NumericInput className="form-input" value={baseAmount} readOnly={!canEditAmount} title={canEditAmount ? undefined : 'You do not have permission to change amounts'} onChange={e => canEditAmount && setBaseAmountRaw(Number(e.target.value))} />
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: '11px' }}>Discount Type</label>
                      <select className="form-select" value={discountType} onChange={e => setDiscountType(e.target.value)}>
                        <option value="None">None (0)</option>
                        <option value="Percentage">Percentage (%)</option>
                        <option value="Fixed">Fixed Amount (₹)</option>
                      </select>
                    </div>
                  </div>

                  {discountType !== 'None' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'center' }}>
                      <div>
                        <label className="form-label" style={{ fontSize: '11px' }}>
                          Discount Value ({discountType === 'Percentage' ? '%' : '₹'})
                        </label>
                        <NumericInput className="form-input" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} />
                      </div>
                      <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600, paddingTop: '16px' }}>
                        -₹{calculatedDiscount.toLocaleString()}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Total Payable</span>
                    <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--brand-primary)' }}>
                      ₹{netPayable.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}

              {!isCapacityFull && planId && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Period start / joining date</label>
                    <input type="date" className="form-input" value={joiningDate} max={todayStr} onChange={(e) => {
                      setJoiningDate(e.target.value);
                      if (proRateApplied) setBaseAmount(Number(suggestedBase));
                    }} />
                    {errors.joiningDate && <span style={{ color: '#ef4444', fontSize: '11px', display: 'block', marginTop: '4px' }}>{errors.joiningDate}</span>}
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Payment date</label>
                    <input type="date" className="form-input" value={paidOn} max={todayStr} min={addDays(todayStr, -60)} onChange={(e) => setPaidOn(e.target.value)} />
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>The day the fee was paid. It can differ from the period start.</span>
                    {errors.paidOn && <span style={{ color: '#ef4444', fontSize: '11px', display: 'block', marginTop: '4px' }}>{errors.paidOn}</span>}
                  </div>
                </div>
              )}

              {/* Payment Method Selector */}
              {!isCapacityFull && planId && (
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Payment Method *</label>
                    <select
                      className="form-select"
                      value={paymentMethod}
                      onChange={e => {
                        const val = e.target.value;
                        setPaymentMethod(val);
                        if (val === 'Split' && splitBreakdown.length < 2) {
                          setSplitBreakdown([
                            { method: 'UPI', amount: '', isManual: false },
                            { method: 'Cash', amount: '', isManual: false }
                          ]);
                        }
                      }}
                    >
                      <option value="">-- Select Payment Method --</option>
                      <option value="UPI">UPI / QR Code</option>
                      <option value="Cash">Cash</option>
                      <option value="Card">Debit / Credit Card</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Net Banking">Net banking</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Split">Split Payment</option>
                    </select>
                    {errors.paymentMethod && <div className="form-error" style={{ color: 'red', fontSize: '11px', marginTop: '4px' }}>{errors.paymentMethod}</div>}
                  </div>
                  <ReferenceField mode={paymentMethod} value={referenceNo} onChange={setReferenceNo} error={errors.referenceNo} />

                  {paymentMethod === 'Split' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                      <label className="form-label" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Split Breakdown</label>
                      {splitBreakdown.map((item, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'center' }}>
                          <select
                            className="form-select"
                            value={item.method}
                            onChange={e => {
                              const newB = [...splitBreakdown];
                              newB[idx].method = e.target.value;
                              setSplitBreakdown(newB);
                            }}
                          >
                            <option value="">-- Method --</option>
                            <option value="UPI">UPI / QR Code</option>
                            <option value="Cash">Cash</option>
                            <option value="Card">Debit / Credit Card</option>
                              <option value="Bank Transfer">Bank Transfer</option>
                              <option value="Net Banking">Net banking</option>
                              <option value="Cheque">Cheque</option>
                            </select>
                          <NumericInput
                            className="form-input"
                            value={item.amount}
                            placeholder="Amount ₹"
                            onChange={e => {
                              setSplitBreakdown(prev => handleSplitAmountChange(prev, idx, e.target.value, netPayable));
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setSplitBreakdown(prev => handleRemoveSplitComponent(prev, idx, netPayable));
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--status-error)', cursor: 'pointer', padding: '4px' }}
                            title="Remove component"
                          >
                            <X size={16} />
                          </button>
                          <ReferenceField
                            compact
                            mode={item.method}
                            value={item.referenceNo}
                            error={errors.referenceNo}
                            onChange={(value) => {
                              const newB = [...splitBreakdown];
                              newB[idx] = { ...newB[idx], referenceNo: value };
                              setSplitBreakdown(newB);
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: '11px', padding: '4px', alignSelf: 'flex-start' }}
                        onClick={() => setSplitBreakdown(prev => handleAddSplitComponent(prev, netPayable))}
                      >
                        + Add Payment Component
                      </button>
                      {errors.splitAmount && <div style={{ color: '#b45309', fontSize: '11px', background: '#fffbeb', padding: '4px 8px', borderRadius: '4px' }}>{errors.splitAmount}</div>}
                      {errors.splitFields && <div style={{ color: 'red', fontSize: '11px' }}>{errors.splitFields}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-light)', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {isCapacityFull && (
              <button type="button" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }} onClick={handleWaitlistSubmit}>
                <Clock size={14} /> Add to Waiting List
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            {!isCapacityFull && (
              <button type="button" className="btn btn-primary" onClick={handleSubmit}>
                Complete Admission
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
