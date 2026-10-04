import React, { useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { 
  Settings, ShieldCheck, Building2, Download, Upload, RefreshCw, 
  Save, Plus, Clock, Trash2, Edit2, AlertTriangle, Copy, FileText, 
  Beaker, CheckCircle2, ChevronRight, X, AlertCircle, Calendar,
  UserPlus, UserCheck, Power, Shield, Check, Minus, Phone, Mail, Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NumericInput } from './NumericInput';
import { SetupWizard } from './SetupWizard';
import { resolveConfigurationScope, matchesScope } from '../utils/scopeResolver';
import { 
  STAFF_MODULES, STAFF_ACTIONS, STAFF_ROLES, 
  createEmptyPermissions, getDefaultPermissionsForRole, countAllowedActions 
} from '../utils/staffPermissions';
import toast from 'react-hot-toast';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const LibrarySettings = ({ settingsAction, onClearSettingsAction, onOpenSetupWizard }) => {
  const { 
    settings, setSettings, branches, setBranches, staffMembers, setStaffMembers, 
    plans, setPlans, shifts, setShifts, seatTypes, setSeatTypes, sections, setSections,
    seats, setSeats, students, currentStaff, activeBranchId,
    exportDataJSON, importDataJSON, resetToDemoData,
    getUnsyncedShifts, getUnsyncedPlans, canDeleteShift, canDeletePlan, canDeleteSeatType,
    copyFromBranch, getSetupStatus, generateTestStudents, clearTestData,
    addStaffMember, updateStaffMember, toggleStaffStatus, deleteStaffMember, hasPermission
  } = useLibrary();

  // Navigation tab for clean organization (Problem 22: Level 2 Category Tabs)
  const [activeTab, setActiveTab] = useState('plans'); // 'plans' | 'shifts' | 'seatTypes' | 'sections' | 'branches' | 'admission' | 'billing' | 'staff' | 'data'
  const [viewLevel, setViewLevel] = useState('branches'); // 'branches' | 'modules' | 'module-view'

  // Setup Wizard Modal State
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const setupStatus = getSetupStatus ? getSetupStatus() : (settings.isSetupComplete ? 'COMPLETED' : 'NOT_STARTED');

  // Canonical Scope State (Level 1: Branch Scope)
  const [selectedBranchId, setSelectedBranchId] = useState(activeBranchId !== 'all' ? activeBranchId : (branches[0]?.id || 'all'));
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [scopeFilterMode, setScopeFilterMode] = useState('all'); // 'all' | 'current'

  const scope = resolveConfigurationScope({
    branches,
    sections,
    selectedBranchId,
    selectedSectionId
  });

  // Handle direct action from Dashboard Action Required issues
  React.useEffect(() => {
    if (!settingsAction) return;

    if (settingsAction.actionType === 'ASSIGN_SHIFT_TO_PLAN') {
      const sh = shifts.find(s => s.id === settingsAction.recordId);
      const targetName = sh?.name || settingsAction.recordName || 'Shift';
      setPlanName(`${targetName} Plan`);
      setPlanShiftIds([settingsAction.recordId]);
      setPlanSeatTypeId(seatTypes[0]?.id || '');
      setEditingPlanId(null);
      setActiveTab('plans');
      setViewLevel('module-view');
      setIsPlanModalOpen(true);
      toast.success(`Prepared new plan for Shift "${targetName}". Check compatible shifts and save.`);
    } else if (settingsAction.actionType === 'EDIT_PLAN_SHIFTS' || settingsAction.actionType === 'EDIT_PLAN_SEAT_TYPE') {
      const plan = plans.find(p => p.id === settingsAction.recordId);
      if (plan) {
        setEditingPlanId(plan.id);
        setPlanName(plan.name);
        setPlanSeatTypeId(plan.seatTypeId || seatTypes[0]?.id || '');
        setPlanSectionId(plan.sectionId || '');
        setPlanShiftIds(plan.shiftIds || []);
        setPlanPricing(plan.durationPricing && plan.durationPricing.length > 0 ? plan.durationPricing : [
          { durationMonths: 1, basePrice: plan.price || 1500, discountType: 'None', discountValue: 0 }
        ]);
        setActiveTab('plans');
        setViewLevel('module-view');
        setIsPlanModalOpen(true);
        toast.success(`Editing Fee Plan "${plan.name}".`);
      }
    } else if (settingsAction.actionType === 'EDIT_SEAT_TYPE') {
      setActiveTab('seatTypes');
      setViewLevel('module-view');
      toast.success(`Opened Seat Types configuration.`);
    }

    if (onClearSettingsAction) onClearSettingsAction();
  }, [settingsAction, shifts, plans, seatTypes, onClearSettingsAction]);

  // Billing & Branding Form State (Problem 21 & 22)
  const [billingFormData, setBillingFormData] = useState({
    name: settings.name || '',
    logo: settings.logo || '',
    phone: settings.phone || '',
    email: settings.email || '',
    address: settings.address || '',
    taxId: settings.taxId || '',
    upiId: settings.upiId || '',
    upiQrUrl: settings.upiQrUrl || '',
    receiptFooter: settings.receiptFooter || '',
    billingCycleMode: settings.billingCycleMode || 'ANNIVERSARY',
    gracePeriodDays: settings.gracePeriodDays ?? 3,
    calendarBillingDay: settings.calendarBillingDay ?? 1
  });

  // Keep billingFormData in sync if settings changes externally
  React.useEffect(() => {
    setBillingFormData({
      name: settings.name || '',
      logo: settings.logo || '',
      phone: settings.phone || '',
      email: settings.email || '',
      address: settings.address || '',
      taxId: settings.taxId || '',
      upiId: settings.upiId || '',
      upiQrUrl: settings.upiQrUrl || '',
      receiptFooter: settings.receiptFooter || '',
      billingCycleMode: settings.billingCycleMode || 'ANNIVERSARY',
      gracePeriodDays: settings.gracePeriodDays ?? 3,
      calendarBillingDay: settings.calendarBillingDay ?? 1
    });
  }, [settings]);

  // Document Types State
  const [docTypes, setDocTypes] = useState(settings.documentTypes || [
    { id: "doc-aadhaar", name: "Aadhaar Card", requirement: "Required", active: true },
    { id: "doc-student-id", name: "Student ID", requirement: "Can Be Submitted Later", active: true },
    { id: "doc-address", name: "Address Proof", requirement: "Can Be Submitted Later", active: true },
    { id: "doc-photo", name: "Photograph", requirement: "Required", active: true },
    { id: "doc-other", name: "Other Document", requirement: "Not Required", active: true }
  ]);
  const [newDocName, setNewDocName] = useState('');
  const [newDocReq, setNewDocReq] = useState('Can Be Submitted Later');

  // Shifts Editing State & Modal
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [shiftName, setShiftName] = useState('');
  const [shiftStart, setShiftStart] = useState('06:00');
  const [shiftEnd, setShiftEnd] = useState('12:00');
  const [shiftDays, setShiftDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

  // Plans Editing State & Modal
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [planName, setPlanName] = useState('');
  const [planSeatTypeId, setPlanSeatTypeId] = useState(seatTypes[0]?.id || '');
  const [planSectionId, setPlanSectionId] = useState('');
  const [planShiftIds, setPlanShiftIds] = useState([]);
  const [planPricing, setPlanPricing] = useState([
    { durationMonths: 1, basePrice: 1500, discountType: 'None', discountValue: 0 }
  ]);

  // Centered Modals & Entity Editing State
  const [isSectionModalOpen, setIsSectionModalOpen] = useState(false);
  const [isSeatTypeModalOpen, setIsSeatTypeModalOpen] = useState(false);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [editingSeatTypeId, setEditingSeatTypeId] = useState(null);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingBranchId, setEditingBranchId] = useState(null);
  const [permSearch, setPermSearch] = useState('');

  // Seat Type Editing State
  const [newSeatTypeName, setNewSeatTypeName] = useState('');
  const [newSeatTypeMode, setNewSeatTypeMode] = useState('Fixed');
  const [newSeatTypeCapMode, setNewSeatTypeCapMode] = useState('Unlimited');
  const [newSeatTypeMax, setNewSeatTypeMax] = useState(50);

  // Branch Cloning State
  const [sourceBranchToCopy, setSourceBranchToCopy] = useState('');
  const [newCopyBranchName, setNewCopyBranchName] = useState('');
  const [newCopyBranchCode, setNewCopyBranchCode] = useState('');

  // New Branch State
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');

  // Section Management State
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionBranchId, setNewSectionBranchId] = useState('');

  // 🧪 Test Data Generator State
  const [testStudentCount, setTestStudentCount] = useState(25);
  const [testGenScope, setTestGenScope] = useState('all');
  const [testGenReport, setTestGenReport] = useState(null);
  const [isGeneratingTest, setIsGeneratingTest] = useState(false);

  // ⚠️ Factory Reset Confirmation Modal State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState('');

  // 👥 Staff Management State
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState(null);
  const [staffFormData, setStaffFormData] = useState({
    name: '',
    phone: '',
    email: '',
    role: 'Librarian',
    branchId: 'all',
    status: 'Active'
  });

  // 🛡️ Granular Permission Matrix Modal State
  const [isPermMatrixModalOpen, setIsPermMatrixModalOpen] = useState(false);
  const [targetPermStaffId, setTargetPermStaffId] = useState(null);
  const [tempPermissions, setTempPermissions] = useState({});

  const unsyncedShifts = getUnsyncedShifts();
  const unsyncedPlans = getUnsyncedPlans();
  const testStudentsCount = students.filter(s => s.isTestData === true || s.source === 'TEST_GENERATOR').length;

  // Save Billing & General Settings Handler (Problem 21 & 22)
  const handleSaveBilling = (e) => {
    e.preventDefault();
    setSettings(prev => ({
      ...prev,
      name: billingFormData.name,
      logo: billingFormData.logo,
      phone: billingFormData.phone,
      email: billingFormData.email,
      address: billingFormData.address,
      taxId: billingFormData.taxId,
      upiId: billingFormData.upiId,
      upiQrUrl: billingFormData.upiQrUrl,
      receiptFooter: billingFormData.receiptFooter,
      billingCycleMode: billingFormData.billingCycleMode,
      gracePeriodDays: Number(billingFormData.gracePeriodDays) || 3,
      calendarBillingDay: Number(billingFormData.calendarBillingDay) || 1
    }));
    toast.success('Library branding, contact & billing configuration saved!');
  };

  // Save Document Requirements Handler
  const handleSaveDocuments = (e) => {
    e.preventDefault();
    const activeNames = docTypes.filter(d => d.active).map(d => d.name);
    setSettings(prev => ({
      ...prev,
      documentTypes: docTypes,
      allowedDocuments: activeNames,
      idProofRequirement: billingFormData.idProofRequirement || 'Required',
      idProofDeadlineDays: Number(billingFormData.idProofDeadlineDays || 7)
    }));
    toast.success('Admission document verification settings saved!');
  };

  // Shift Management Handlers
  const handleOpenAddShift = () => {
    setEditingShiftId(null);
    setShiftName('');
    setShiftStart('06:00');
    setShiftEnd('12:00');
    setShiftDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    setIsShiftModalOpen(true);
  };

  const handleEditShift = (sh) => {
    setEditingShiftId(sh.id);
    setShiftName(sh.name || '');
    setShiftStart(sh.startTime || '06:00');
    setShiftEnd(sh.endTime || '12:00');
    setShiftDays(sh.daysOfWeek || ALL_DAYS);
    setIsShiftModalOpen(true);
  };

  const handleSaveShift = (e) => {
    e.preventDefault();
    if (!shiftName.trim()) return toast.error('Shift name is required.');

    if (editingShiftId) {
      setShifts(prev => prev.map(s => s.id === editingShiftId ? {
        ...s,
        name: shiftName.trim(),
        startTime: shiftStart,
        endTime: shiftEnd,
        daysOfWeek: shiftDays
      } : s));
      setEditingShiftId(null);
      toast.success('Shift updated.');
    } else {
      const newSh = {
        id: `sh-${Date.now()}`,
        name: shiftName.trim(),
        startTime: shiftStart,
        endTime: shiftEnd,
        daysOfWeek: shiftDays,
        branchId: selectedBranchId !== 'all' ? selectedBranchId : (scope.resolvedBranchId || undefined),
        sectionId: scope.resolvedSectionId || undefined,
        libraryId: settings.libraryId,
        active: true
      };
      setShifts(prev => [...prev, newSh]);
      toast.success('Shift added.');
    }

    setShiftName('');
    setIsShiftModalOpen(false);
  };

  const handleDeleteShift = (shift) => {
    const check = canDeleteShift(shift.id);
    if (!check.allowed) {
      toast.error(check.reason);
      return;
    }
    if (window.confirm(`Delete shift "${shift.name}"?`)) {
      setShifts(prev => prev.filter(s => s.id !== shift.id));
      toast.success('Shift deleted.');
    }
  };

  // Plan Management Handlers
  const handleOpenAddPlan = () => {
    setEditingPlanId(null);
    setPlanName('');
    setPlanSeatTypeId(seatTypes[0]?.id || '');
    setPlanSectionId('');
    setPlanShiftIds([]);
    setPlanPricing([
      { durationMonths: 1, basePrice: 1500, discountType: 'None', discountValue: 0 }
    ]);
    setIsPlanModalOpen(true);
  };

  const handleEditPlan = (p) => {
    setEditingPlanId(p.id);
    setPlanName(p.name || '');
    setPlanSeatTypeId(p.seatTypeId || seatTypes[0]?.id || '');
    setPlanSectionId(p.sectionId || '');
    setPlanShiftIds(p.shiftIds || []);
    setPlanPricing(p.durationPricing && p.durationPricing.length > 0 ? p.durationPricing : [
      { durationMonths: 1, basePrice: p.price || 1500, discountType: 'None', discountValue: 0 }
    ]);
    setIsPlanModalOpen(true);
  };

  const handleSavePlan = (e) => {
    e.preventDefault();
    if (!planName.trim()) return toast.error('Plan name is required.');
    if (!planSeatTypeId) return toast.error('Please assign a Seat Type to this plan.');
    if (planShiftIds.length === 0) return toast.error('Assign at least one shift to this plan.');

    if (editingPlanId) {
      setPlans(prev => prev.map(p => p.id === editingPlanId ? {
        ...p,
        name: planName.trim(),
        seatTypeId: planSeatTypeId,
        sectionId: planSectionId || undefined,
        shiftIds: planShiftIds,
        durationPricing: planPricing
      } : p));
      setEditingPlanId(null);
      toast.success('Fee Plan updated.');
    } else {
      const newPlan = {
        id: `pl-${Date.now()}`,
        name: planName.trim(),
        seatTypeId: planSeatTypeId,
        sectionId: planSectionId || scope.resolvedSectionId || undefined,
        shiftIds: planShiftIds,
        durationPricing: planPricing,
        branchId: selectedBranchId !== 'all' ? selectedBranchId : (scope.resolvedBranchId || undefined),
        libraryId: settings.libraryId,
        active: true
      };
      setPlans(prev => [...prev, newPlan]);
      toast.success('Fee Plan created.');
    }

    setPlanName('');
    setIsPlanModalOpen(false);
  };

  const handleDeletePlan = (plan) => {
    const check = canDeletePlan(plan.id);
    if (!check.allowed) {
      toast.error(check.reason);
      return;
    }
    if (window.confirm(`Delete plan "${plan.name}"?`)) {
      setPlans(prev => prev.filter(p => p.id !== plan.id));
      toast.success('Plan deleted.');
    }
  };

  // Seat Type Handlers
  const handleOpenAddSeatType = () => {
    setEditingSeatTypeId(null);
    setNewSeatTypeName('');
    setNewSeatTypeMode('Fixed');
    setNewSeatTypeCapMode('Unlimited');
    setNewSeatTypeMax(50);
    setIsSeatTypeModalOpen(true);
  };

  const handleEditSeatType = (st) => {
    setEditingSeatTypeId(st.id);
    setNewSeatTypeName(st.name || '');
    setNewSeatTypeMode(st.allocationMode || 'Fixed');
    setNewSeatTypeCapMode(st.capacityMode || 'Unlimited');
    setNewSeatTypeMax(st.maximumStudentsAllowed || 50);
    setIsSeatTypeModalOpen(true);
  };

  const handleSaveSeatType = (e) => {
    e.preventDefault();
    if (!newSeatTypeName.trim()) return toast.error('Seat Type name is required.');

    if (editingSeatTypeId) {
      setSeatTypes(prev => prev.map(st => st.id === editingSeatTypeId ? {
        ...st,
        name: newSeatTypeName.trim(),
        allocationMode: newSeatTypeMode,
        capacityMode: newSeatTypeMode === 'Non-Fixed' ? newSeatTypeCapMode : null,
        maximumStudentsAllowed: newSeatTypeMode === 'Non-Fixed' && newSeatTypeCapMode === 'Limited' ? Number(newSeatTypeMax) : null
      } : st));
      setEditingSeatTypeId(null);
      toast.success('Seat Type updated.');
    } else {
      const newSt = {
        id: `st-${Date.now()}`,
        name: newSeatTypeName.trim(),
        allocationMode: newSeatTypeMode,
        capacityMode: newSeatTypeMode === 'Non-Fixed' ? newSeatTypeCapMode : null,
        maximumStudentsAllowed: newSeatTypeMode === 'Non-Fixed' && newSeatTypeCapMode === 'Limited' ? Number(newSeatTypeMax) : null,
        branchId: selectedBranchId !== 'all' ? selectedBranchId : (scope.resolvedBranchId || undefined),
        sectionId: scope.resolvedSectionId || undefined,
        libraryId: settings.libraryId
      };
      setSeatTypes(prev => [...prev, newSt]);
      toast.success('Seat Type added.');
    }

    setNewSeatTypeName('');
    setIsSeatTypeModalOpen(false);
  };

  const handleDeleteSeatType = (st) => {
    const check = canDeleteSeatType(st.id);
    if (!check.allowed) return toast.error(check.reason);
    if (window.confirm(`Delete seat type "${st.name}"?`)) {
      setSeatTypes(prev => prev.filter(item => item.id !== st.id));
      toast.success('Seat type removed.');
    }
  };

  // Branch Handlers
  const handleOpenAddBranch = () => {
    setEditingBranchId(null);
    setNewBranchName('');
    setNewBranchCode('');
    setNewBranchAddress('');
    setIsBranchModalOpen(true);
  };

  const handleEditBranch = (b) => {
    setEditingBranchId(b.id);
    setNewBranchName(b.name || '');
    setNewBranchCode(b.code || '');
    setNewBranchAddress(b.address || '');
    setIsBranchModalOpen(true);
  };

  const handleSaveBranch = (e) => {
    e.preventDefault();
    if (!newBranchName.trim()) return toast.error('Branch name is required.');
    const cleanCode = (newBranchCode.trim() || newBranchName.trim().slice(0, 3)).toUpperCase().slice(0, 4);

    if (editingBranchId) {
      setBranches(prev => prev.map(b => b.id === editingBranchId ? {
        ...b,
        name: newBranchName.trim(),
        code: cleanCode,
        address: newBranchAddress.trim()
      } : b));
      setEditingBranchId(null);
      toast.success('Branch updated.');
    } else {
      const newB = { 
        id: `b-${Date.now()}`, 
        code: cleanCode, 
        name: newBranchName.trim(), 
        address: newBranchAddress.trim(), 
        libraryId: settings.libraryId,
        active: true 
      };
      setBranches(prev => [...prev, newB]);
      toast.success('Branch added.');
    }

    setNewBranchName('');
    setNewBranchCode('');
    setNewBranchAddress('');
    setIsBranchModalOpen(false);
  };

  const handleCopyBranch = (e) => {
    e.preventDefault();
    if (!sourceBranchToCopy || !newCopyBranchName) {
      toast.error('Select source branch and provide name.');
      return;
    }
    const cleanCode = (newCopyBranchCode.trim() || newCopyBranchName.trim().slice(0, 3)).toUpperCase().slice(0, 4);
    const cloned = copyFromBranch(sourceBranchToCopy, newCopyBranchName, cleanCode);
    if (cloned) {
      toast.success(`Successfully copied branch configuration to "${newCopyBranchName}"!`);
      setNewCopyBranchName('');
      setNewCopyBranchCode('');
      setSourceBranchToCopy('');
    }
  };

  // Section Handlers
  const handleOpenAddSection = () => {
    setEditingSectionId(null);
    setNewSectionName('');
    setNewSectionBranchId(selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id || ''));
    setIsSectionModalOpen(true);
  };

  const handleEditSection = (sec) => {
    setEditingSectionId(sec.id);
    setNewSectionName(sec.name || '');
    setNewSectionBranchId(sec.branchId || branches[0]?.id || '');
    setIsSectionModalOpen(true);
  };

  const handleSaveSection = (e) => {
    e.preventDefault();
    if (!newSectionName.trim()) return toast.error('Section name is required.');

    if (editingSectionId) {
      setSections(prev => prev.map(s => s.id === editingSectionId ? {
        ...s,
        name: newSectionName.trim(),
        branchId: newSectionBranchId || undefined
      } : s));
      setEditingSectionId(null);
      toast.success('Section updated.');
    } else {
      const targetBranchId = branches.length > 0 ? (newSectionBranchId || branches[0]?.id) : undefined;
      const newSec = {
        id: `sec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: newSectionName.trim(),
        branchId: targetBranchId,
        libraryId: settings.libraryId,
        active: true
      };
      setSections(prev => [...prev, newSec]);
      toast.success('Section added.');
    }

    setNewSectionName('');
    setIsSectionModalOpen(false);
  };

  const handleDeleteSection = (sec) => {
    if (window.confirm(`Delete section "${sec.name}"?`)) {
      setSections(prev => prev.filter(s => s.id !== sec.id));
      toast.success('Section removed.');
    }
  };

  // 🧪 Test Data Generator Handlers
  const handleGenerateTestStudents = () => {
    const count = Number(testStudentCount) || 25;
    if (count <= 0 || count > 200) {
      return toast.error("Please enter between 1 and 200 students to generate.");
    }
    setIsGeneratingTest(true);
    setTimeout(() => {
      const report = generateTestStudents(count, { branchScope: testGenScope });
      setTestGenReport(report);
      setIsGeneratingTest(false);
      if (report.created > 0) {
        toast.success(`Successfully generated ${report.created} test students!`);
      } else {
        toast.error(`Unable to generate test students: ${report.reasons?.[0] || 'Configuration full'}`);
      }
    }, 200);
  };

  const handleClearTestData = () => {
    if (testStudentsCount === 0) return toast("No test data found to clear.");
    if (window.confirm(`Are you sure you want to remove ${testStudentsCount} synthetic test students and their payment records?\n\nReal students and configurations will NOT be affected.`)) {
      const result = clearTestData();
      setTestGenReport(null);
      toast.success(`Cleaned up ${result.count} test student records.`);
    }
  };

  // Factory Reset Execution
  const handleExecuteFactoryReset = () => {
    if (resetConfirmInput.trim() !== 'RESET') {
      return toast.error('Type "RESET" to confirm.');
    }
    resetToDemoData();
    setIsResetModalOpen(false);
    setResetConfirmInput('');
    toast.success('Factory reset completed. System restored to clean initial state.');
  };

  // Staff Directory & Modal Handlers
  const handleOpenAddStaff = () => {
    setEditingStaffId(null);
    setStaffFormData({
      name: '',
      phone: '',
      email: '',
      role: 'Librarian',
      branchId: activeBranchId !== 'all' ? activeBranchId : 'all',
      status: 'Active'
    });
    setIsStaffModalOpen(true);
  };

  const handleOpenEditStaff = (staff) => {
    setEditingStaffId(staff.id);
    setStaffFormData({
      name: staff.name || '',
      phone: staff.phone || '',
      email: staff.email || '',
      role: staff.role || 'Librarian',
      branchId: staff.branchId || 'all',
      status: staff.status || 'Active'
    });
    setIsStaffModalOpen(true);
  };

  const handleSaveStaffForm = (e) => {
    e.preventDefault();
    if (!staffFormData.name.trim()) {
      return toast.error('Please enter full name of staff member');
    }
    if (!staffFormData.phone.trim()) {
      return toast.error('Please enter contact / mobile number');
    }

    if (editingStaffId) {
      const ok = updateStaffMember(editingStaffId, staffFormData);
      if (ok) setIsStaffModalOpen(false);
    } else {
      const created = addStaffMember(staffFormData);
      if (created) setIsStaffModalOpen(false);
    }
  };

  const handleOpenPermMatrix = (staff) => {
    setTargetPermStaffId(staff.id);
    const currentPerms = staff.permissions || getDefaultPermissionsForRole(staff.role);
    const cloned = {};
    STAFF_MODULES.forEach(mod => {
      cloned[mod.id] = {
        view: Boolean(currentPerms[mod.id]?.view),
        create: Boolean(currentPerms[mod.id]?.create),
        edit: Boolean(currentPerms[mod.id]?.edit),
        delete: Boolean(currentPerms[mod.id]?.delete),
        approve: Boolean(currentPerms[mod.id]?.approve),
        manage: Boolean(currentPerms[mod.id]?.manage)
      };
    });
    setTempPermissions(cloned);
    setIsPermMatrixModalOpen(true);
  };

  const handleToggleActionPerm = (moduleId, actionId) => {
    setTempPermissions(prev => {
      const modObj = { ...(prev[moduleId] || {}) };
      const nextVal = !modObj[actionId];
      modObj[actionId] = nextVal;
      if (nextVal && actionId !== 'view') {
        modObj.view = true;
      }
      if (actionId === 'manage') {
        STAFF_ACTIONS.forEach(a => {
          modObj[a.id] = nextVal;
        });
      } else {
        const allOthers = ['view', 'create', 'edit', 'delete', 'approve'].every(a => modObj[a]);
        modObj.manage = allOthers;
      }
      return {
        ...prev,
        [moduleId]: modObj
      };
    });
  };

  const handleToggleModuleAll = (moduleId) => {
    setTempPermissions(prev => {
      const modObj = { ...(prev[moduleId] || {}) };
      const currentlyAll = STAFF_ACTIONS.every(a => modObj[a.id]);
      const nextVal = !currentlyAll;
      const updated = {};
      STAFF_ACTIONS.forEach(a => {
        updated[a.id] = nextVal;
      });
      return {
        ...prev,
        [moduleId]: updated
      };
    });
  };

  const handleApplyRolePreset = (roleName) => {
    const preset = getDefaultPermissionsForRole(roleName);
    const cloned = {};
    STAFF_MODULES.forEach(mod => {
      cloned[mod.id] = {
        view: Boolean(preset[mod.id]?.view),
        create: Boolean(preset[mod.id]?.create),
        edit: Boolean(preset[mod.id]?.edit),
        delete: Boolean(preset[mod.id]?.delete),
        approve: Boolean(preset[mod.id]?.approve),
        manage: Boolean(preset[mod.id]?.manage)
      };
    });
    setTempPermissions(cloned);
    toast.success(`Loaded preset permissions for "${roleName}"`);
  };

  const handleSavePermMatrix = () => {
    if (!targetPermStaffId) return;
    const ok = updateStaffMember(targetPermStaffId, { permissions: tempPermissions });
    if (ok) {
      setIsPermMatrixModalOpen(false);
      setTargetPermStaffId(null);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        if (importDataJSON(JSON.parse(event.target.result))) toast.success('Database restored successfully from JSON backup!');
        else toast.error('Invalid backup file format.');
      } catch (err) { toast.error('Error parsing JSON backup file.'); }
    };
    reader.readAsText(file);
  };

  const displayedShifts = selectedBranchId === 'all' 
    ? shifts 
    : shifts.filter(sh => !sh.branchId || sh.branchId === 'all' || sh.branchId === selectedBranchId);
  const displayedPlans = selectedBranchId === 'all' 
    ? plans 
    : plans.filter(p => !p.branchId || p.branchId === 'all' || p.branchId === selectedBranchId);
  const displayedSeatTypes = selectedBranchId === 'all' 
    ? seatTypes 
    : seatTypes.filter(st => !st.branchId || st.branchId === 'all' || st.branchId === selectedBranchId);
  const displayedSections = selectedBranchId === 'all'
    ? sections
    : sections.filter(sec => sec.branchId === selectedBranchId || (!sec.branchId && branches.length <= 1));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header Bar with State-Aware Setup Wizard Entry Point */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Administration & Settings
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Global configuration, operating shifts, fee plans, branches, test data tools, and security
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* SETUP WIZARD ENTRY POINT */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <span style={{
              fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
              background: setupStatus === 'COMPLETED' ? '#dcfce7' : (setupStatus === 'DRAFT' ? '#fef3c7' : '#fee2e2'),
              color: setupStatus === 'COMPLETED' ? '#15803d' : (setupStatus === 'DRAFT' ? '#b45309' : '#b91c1c')
            }}>
              {setupStatus === 'COMPLETED' ? 'COMPLETED' : (setupStatus === 'DRAFT' ? 'DRAFT' : 'NOT STARTED')}
            </span>
            <button 
              type="button" 
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => onOpenSetupWizard ? onOpenSetupWizard(setupStatus === 'COMPLETED') : setIsSetupWizardOpen(true)}
            >
              <Settings size={15} />
              {setupStatus === 'COMPLETED' ? '⚙ Edit Setup' : (setupStatus === 'DRAFT' ? '⚙ Continue Setup' : '⚙ Start Setup')}
            </button>
          </div>
        </div>
      </div>

      {/* Action Required: Unsynced Shifts & Plans Banner */}
      {(unsyncedShifts.length > 0 || unsyncedPlans.length > 0) && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <AlertTriangle size={22} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#991b1b', marginBottom: '4px' }}>
              ⚠️ Action Required: Unsynchronized Configuration
            </h4>
            <div style={{ fontSize: '13px', color: '#b91c1c', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {unsyncedShifts.map(sh => (
                <div key={sh.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Shift "<strong>{sh.name}</strong>" is not connected to any plan. It is hidden from admissions.</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      style={{ fontSize: '11px', color: '#1d4ed8', background: '#eff6ff', padding: '2px 8px' }}
                      onClick={() => {
                        setPlanName(`${sh.name} Plan`);
                        setPlanShiftIds([sh.id]);
                        setPlanSeatTypeId(seatTypes[0]?.id || '');
                        setActiveTab('config');
                        toast.success(`Prepared Plan for "${sh.name}". Scroll to Plans below to save.`);
                      }}
                    >
                      Assign to Plan
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      style={{ fontSize: '11px', color: '#ef4444', background: '#fff', padding: '2px 8px' }}
                      onClick={() => handleDeleteShift(sh)}
                    >
                      Delete Shift
                    </button>
                  </div>
                </div>
              ))}

              {unsyncedPlans.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Plan "<strong>{p.name}</strong>" has no active shifts assigned. It is hidden from admissions.</span>
                  <button 
                    type="button" 
                    className="btn btn-ghost" 
                    style={{ fontSize: '11px', color: '#1d4ed8', background: '#eff6ff', padding: '2px 8px' }}
                    onClick={() => handleEditPlan(p)}
                  >
                    Edit Plan Shifts
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* LEVEL 1: VERTICAL BRANCH LIST (Problem 22) */}
      {/* ======================================================== */}
      {viewLevel === 'branches' && (
        <div className="premium-card">
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px' }}>Library Settings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {branches.map(b => (
              <button
                key={b.id}
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '16px', fontSize: '15px' }}
                onClick={() => { setSelectedBranchId(b.id); setSelectedSectionId(''); setViewLevel('modules'); }}
              >
                🏢 {b.name} ({b.code})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* LEVEL 2: VERTICAL CATEGORY LIST (Problem 22) */}
      {/* ======================================================== */}
      {viewLevel === 'modules' && (
        <div className="premium-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <button className="btn btn-ghost" onClick={() => setViewLevel('branches')} style={{ padding: '8px' }}>
              <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} /> Back
            </button>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
              {branches.find(b => b.id === selectedBranchId)?.name || 'Library Options'}
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { id: 'plans', label: '💳 Fee Plans' },
              { id: 'shifts', label: '⏰ Operating Shifts' },
              { id: 'seatTypes', label: '🪑 Seat Types' },
              { id: 'sections', label: '🚪 Sections / Rooms' },
              { id: 'branches', label: '🏢 Branch Details' },
              { id: 'admission', label: '📄 Document Requirements' },
              { id: 'billing', label: '⚙️ General & Billing Settings' },
              { id: 'staff', label: '👥 Staff Permissions' },
              { id: 'data', label: '💾 Data Hub & Testing' }
            ].map(tab => (
              <button
                key={tab.id}
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '16px', fontSize: '15px' }}
                onClick={() => { setActiveTab(tab.id); setViewLevel('module-view'); }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* LEVEL 3: MODULE VIEW WITH BACK BUTTON */}
      {/* ======================================================== */}
      {viewLevel === 'module-view' && (
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-ghost" onClick={() => setViewLevel('modules')} style={{ padding: '8px' }}>
            <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} /> Back to Options
          </button>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
            {branches.find(b => b.id === selectedBranchId)?.name} / {activeTab}
          </span>
        </div>
      )}

      {viewLevel === 'module-view' && (
        <div style={{ display: 'block' }}>

      {/* ======================================================== */}
      {/* CATEGORY 1: FEE PLANS (WHAT) */}
      {/* ======================================================== */}
      {(activeTab === 'plans' || activeTab === 'config') && (
        <div id="plans-section" className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building2 size={18} color="#10b981" /><span>Fee Plans Management</span>
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Configured duration pricing and shift bundles for {selectedBranchId === 'all' ? 'All Branches' : (branches.find(b => b.id === selectedBranchId)?.name || 'Current Branch')}.
              </p>
            </div>
            <button
              id="btn-add-plan"
              type="button"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
              onClick={handleOpenAddPlan}
            >
              <Plus size={15} /> Add Fee Plan
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {displayedPlans.map(p => {
              const applicableShifts = shifts.filter(sh => p.shiftIds?.includes(sh.id));
              const linkedSeatType = seatTypes.find(st => st.id === p.seatTypeId);
              return (
                <div key={p.id} style={{ padding: '16px', background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h4 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>{p.name}</h4>
                        {(p.branchId || p.sectionId) && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                            {branches.find(b => b.id === p.branchId)?.name || 'Branch'}{p.sectionId ? ` → ${sections.find(s => s.id === p.sectionId)?.name || 'Section'}` : ''}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '12px', color: linkedSeatType ? 'var(--text-secondary)' : '#dc2626', fontWeight: linkedSeatType ? 400 : 600 }}>
                        Seat Type: {linkedSeatType ? linkedSeatType.name : '⚠️ Missing Seat Type'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--brand-primary)' }} onClick={() => handleEditPlan(p)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn btn-ghost" style={{ padding: '4px', color: '#ef4444' }} onClick={() => handleDeletePlan(p)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <strong>Shifts:</strong> {applicableShifts.map(s => s.name).join(', ') || <span style={{ color: '#ef4444' }}>None assigned</span>}
                  </div>

                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)' }}>DURATION PRICING:</span>
                    {(p.durationPricing || []).map((dp, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span>{dp.durationMonths} Mo</span>
                        <span style={{ fontWeight: 600 }}>₹{dp.basePrice?.toLocaleString()} {dp.discountType && dp.discountType !== 'None' ? `(Offer: ${dp.discountValue}${dp.discountType === 'Percentage' ? '%' : '₹'})` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CATEGORY 2: OPERATING SHIFTS (WHEN) */}
      {/* ======================================================== */}
      {activeTab === 'shifts' && (
        <div id="shifts-section" className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={18} color="var(--brand-primary)" /><span>Operating Shifts</span>
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Daily study schedules and timing slots for students.
              </p>
            </div>
            <button
              id="btn-add-shift"
              type="button"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
              onClick={handleOpenAddShift}
            >
              <Plus size={15} /> Add Shift
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
            {displayedShifts.map(sh => {
              const isUnsynced = getUnsyncedShifts ? getUnsyncedShifts().some(s => s.id === sh.id) : false;
              let scopeLabel = 'All Branches';
              if (sh.branchId && sh.branchId !== 'all') {
                const b = branches.find(br => br.id === sh.branchId);
                scopeLabel = b?.name || 'Branch';
              }

              return (
                <div key={sh.id} style={{ padding: '14px', background: '#f8fafc', border: isUnsynced ? '1px solid #fde68a' : '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px' }}>{sh.name}</strong>
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                        📍 {scopeLabel}
                      </span>
                      {isUnsynced && (
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: '#fef3c7', color: '#b45309', fontWeight: 700, border: '1px solid #fde68a' }}>
                          ⚠️ Unassigned
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      🕒 {sh.startTime} – {sh.endTime} ({sh.daysOfWeek?.length || 7} days/wk)
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      style={{ padding: '4px', color: 'var(--brand-primary)' }}
                      onClick={() => handleEditShift(sh)}
                    >
                      <Edit2 size={15} />
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      style={{ padding: '4px', color: '#ef4444' }}
                      onClick={() => handleDeleteShift(sh)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CATEGORY 3: SEAT TYPES */}
      {/* ======================================================== */}
      {activeTab === 'seatTypes' && (
        <div id="seat-types-section" className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building2 size={18} color="#6366f1" /><span>Seat Types (Fixed vs Non-Fixed)</span>
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Defines physical desk allocation vs floating capacity seats.
              </p>
            </div>
            <button
              id="btn-add-seat-type"
              type="button"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
              onClick={handleOpenAddSeatType}
            >
              <Plus size={15} /> Add Seat Type
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {displayedSeatTypes.map(st => {
              const physicalSeats = (seats || []).filter(s => s.seatTypeId === st.id);
              const seatCount = physicalSeats.length;

              let capacitySubtitle = '';
              if (st.allocationMode === 'Fixed') {
                capacitySubtitle = `Fixed (${seatCount} ${seatCount === 1 ? 'seat' : 'seats'})`;
              } else {
                if (st.capacityMode === 'Limited' && st.maximumStudentsAllowed) {
                  capacitySubtitle = `Non-Fixed (${st.maximumStudentsAllowed} max)`;
                } else {
                  capacitySubtitle = `Non-Fixed (Unlimited)`;
                }
              }

              return (
                <div key={st.id} style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '14px' }}>{st.name}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: 500 }}>
                      {capacitySubtitle}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" className="btn btn-ghost" style={{ color: 'var(--brand-primary)', padding: '4px' }} onClick={() => handleEditSeatType(st)}>
                      <Edit2 size={15} />
                    </button>
                    <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '4px' }} onClick={() => handleDeleteSeatType(st)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CATEGORY 4: SECTIONS & ROOMS */}
      {/* ======================================================== */}
      {activeTab === 'sections' && (
        <div className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building2 size={18} color="#0284c7" /><span>Sections & Study Rooms</span>
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Room partitions and study zones within branches.
              </p>
            </div>
            <button
              id="btn-add-section"
              type="button"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
              onClick={handleOpenAddSection}
            >
              <Plus size={15} /> Add Section
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {displayedSections.length === 0 ? (
              <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed var(--border-light)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                No sections configured in this scope (Open single-hall layout).
              </div>
            ) : (
              displayedSections.map(sec => {
                const parentBranch = branches.find(b => b.id === sec.branchId);
                const sectionSeatsCount = (seats || []).filter(s => s.sectionId === sec.id).length;
                return (
                  <div key={sec.id} style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '14px' }}>{sec.name}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {parentBranch ? `Branch: ${parentBranch.name}` : 'Direct Section'} • {sectionSeatsCount} desks
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button type="button" className="btn btn-ghost" style={{ color: 'var(--brand-primary)', padding: '4px' }} onClick={() => handleEditSection(sec)}>
                        <Edit2 size={15} />
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '4px' }} onClick={() => handleDeleteSection(sec)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CATEGORY 5: BRANCH DETAILS & DIRECTORY */}
      {/* ======================================================== */}
      {activeTab === 'branches' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="premium-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={18} color="#f59e0b" /><span>Branch Directory</span>
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                  Physical library locations and branch code identifiers.
                </p>
              </div>
              <button
                id="btn-add-branch"
                type="button"
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
                onClick={handleOpenAddBranch}
              >
                <Plus size={15} /> Add Blank Branch
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {branches.map(b => {
                const bSeatsCount = (seats || []).filter(s => s.branchId === b.id).length;
                const bSectionsCount = sections.filter(s => s.branchId === b.id).length;
                return (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                    <div>
                      <strong style={{ fontSize: '14px' }}>{b.name}</strong> <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary)', background: '#eff6ff', padding: '2px 6px', borderRadius: '4px' }}>{b.code}</span>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {b.address || 'No address specified'} • {bSectionsCount} sections • {bSeatsCount} desks
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="badge badge-active">ACTIVE</span>
                      <button type="button" className="btn btn-ghost" style={{ color: 'var(--brand-primary)', padding: '4px' }} onClick={() => handleEditBranch(b)}>
                        <Edit2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Copy Branch Template */}
          {branches.length > 0 && (
            <div className="premium-card" style={{ padding: '20px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Copy size={16} /> Clone Configuration From Existing Branch
              </h4>
              <p style={{ fontSize: '12px', color: '#1e3a8a', marginBottom: '14px' }}>
                Clones sections, seat types, shifts, and fee plans into a new branch with fresh canonical IDs.
              </p>
              <form onSubmit={handleCopyBranch} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '11px' }}>Source Branch</label>
                  <select className="form-select" value={sourceBranchToCopy} onChange={e => setSourceBranchToCopy(e.target.value)} required>
                    <option value="">Select Source Branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '11px' }}>New Branch Name</label>
                  <input className="form-input" placeholder="e.g. West Campus" value={newCopyBranchName} onChange={e => setNewCopyBranchName(e.target.value)} required />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '11px' }}>Code (Auto)</label>
                  <input className="form-input" placeholder="WC" maxLength={4} value={newCopyBranchCode} onChange={e => setNewCopyBranchCode(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ background: '#2563eb' }}>
                  Clone Branch
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* CATEGORY 6: DOCUMENT REQUIREMENTS */}
      {/* ======================================================== */}
      {activeTab === 'admission' && (
        <div className="premium-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} color="var(--brand-primary)" /><span>Admission Document Verification Policies</span>
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Configure individual admission document requirements (Required at Admission, Can Be Submitted Later, or Not Required).
          </p>

          <form onSubmit={handleSaveDocuments}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {docTypes.map(doc => (
                <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input 
                      type="checkbox" 
                      checked={doc.active} 
                      onChange={() => setDocTypes(docTypes.map(d => d.id === doc.id ? { ...d, active: !d.active } : d))}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <div>
                      <strong style={{ fontSize: '13px' }}>{doc.name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {doc.active ? 'Active on admission form' : 'Deactivated / Hidden'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <select 
                      className="form-select" 
                      style={{ fontSize: '12px', padding: '4px 8px' }}
                      value={doc.requirement} 
                      onChange={e => setDocTypes(docTypes.map(d => d.id === doc.id ? { ...d, requirement: e.target.value } : d))}
                      disabled={!doc.active}
                    >
                      <option value="Required">Required at Admission</option>
                      <option value="Can Be Submitted Later">Can Be Submitted Later</option>
                      <option value="Not Required">Not Required</option>
                    </select>

                    {doc.id.startsWith('custom-') && (
                      <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '4px' }} onClick={() => setDocTypes(docTypes.filter(d => d.id !== doc.id))}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Custom Document Type */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', background: '#fff', border: '1px solid var(--border-light)', padding: '14px', borderRadius: '8px', marginBottom: '20px' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '11px' }}>Custom Document Type</label>
                <input className="form-input" placeholder="e.g. College Bonafide, Employee ID" value={newDocName} onChange={e => setNewDocName(e.target.value)} />
              </div>
              <div className="form-group" style={{ width: '220px', marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '11px' }}>Requirement Policy</label>
                <select className="form-select" value={newDocReq} onChange={e => setNewDocReq(e.target.value)}>
                  <option value="Required">Required at Admission</option>
                  <option value="Can Be Submitted Later">Can Be Submitted Later</option>
                  <option value="Not Required">Not Required</option>
                </select>
              </div>
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={() => {
                  if (!newDocName.trim()) return toast.error("Document name required.");
                  setDocTypes([...docTypes, {
                    id: `custom-${Date.now()}`,
                    name: newDocName.trim(),
                    requirement: newDocReq,
                    active: true
                  }]);
                  setNewDocName('');
                  toast.success("Added custom document type.");
                }}
              >
                <Plus size={14} /> Add
              </button>
            </div>

            {/* General Policy & Deadline Days */}
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)', marginBottom: '20px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Deferred Submission Settings</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>General Policy Mode</label>
                  <select className="form-select" value={billingFormData.idProofRequirement || 'Required'} onChange={(e) => setBillingFormData({...billingFormData, idProofRequirement: e.target.value})}>
                    <option value="Required">Required at Admission</option>
                    <option value="Can Be Submitted Later">Can Be Submitted Later</option>
                    <option value="Not Required">Not Required</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Deadline Days (For Pending Proofs)</label>
                  <NumericInput className="form-input" value={billingFormData.idProofDeadlineDays || 7} onChange={(e) => setBillingFormData({...billingFormData, idProofDeadlineDays: Number(e.target.value)})} />
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary">
              <Save size={15} /> Save Document Verification Settings
            </button>
          </form>
        </div>
      )}

      {/* ======================================================== */}
      {/* CATEGORY 7: GENERAL & BILLING SETTINGS (Problem 21 & 22) */}
      {/* ======================================================== */}
      {(activeTab === 'billing' || activeTab === 'branding') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Subscription & Flexible Billing Policy (Problem 21) */}
          <div className="premium-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={18} color="var(--brand-primary)" /><span>Subscription & Billing Schedule Configuration</span>
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Define the default renewal due date scheduling and grace period for active subscriptions.
            </p>

            <form onSubmit={handleSaveBilling}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Default Billing Cycle Mode</label>
                  <select 
                    className="form-select" 
                    value={billingFormData.billingCycleMode} 
                    onChange={e => setBillingFormData(p => ({ ...p, billingCycleMode: e.target.value }))}
                  >
                    <option value="ANNIVERSARY">Anniversary-Based (Join Date to same date next month)</option>
                    <option value="CALENDAR_MONTH">Calendar-Month Based (1st to month-end)</option>
                  </select>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    {billingFormData.billingCycleMode === 'ANNIVERSARY' 
                      ? 'Example: Joined 15 Feb → Due 15 Mar (coverage 15 Feb–14 Mar).' 
                      : 'Example: Billed on 1st of each calendar month.'}
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Normal Grace Period (Days)</label>
                  <NumericInput 
                    className="form-input" 
                    value={billingFormData.gracePeriodDays} 
                    onChange={e => setBillingFormData(p => ({ ...p, gracePeriodDays: Number(e.target.value) || 0 }))} 
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    Days after due date before subscription is marked Expired.
                  </span>
                </div>

                {billingFormData.billingCycleMode === 'CALENDAR_MONTH' && (
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Calendar Billing Day of Month (1-28)</label>
                    <NumericInput 
                      className="form-input" 
                      value={billingFormData.calendarBillingDay} 
                      onChange={e => setBillingFormData(p => ({ ...p, calendarBillingDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) }))} 
                    />
                  </div>
                )}
              </div>

              {/* Library Identity & Contact Settings */}
              <h4 style={{ fontSize: '14px', fontWeight: 700, marginTop: '24px', marginBottom: '14px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                Library Branding & Payment Credentials
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <div className="form-group">
                  <label className="form-label">Library Name *</label>
                  <input type="text" className="form-input" value={billingFormData.name} onChange={(e) => setBillingFormData(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input type="text" className="form-input" value={billingFormData.phone} onChange={(e) => setBillingFormData(p => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" value={billingFormData.email} onChange={(e) => setBillingFormData(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Address</label>
                  <input type="text" className="form-input" value={billingFormData.address} onChange={(e) => setBillingFormData(p => ({ ...p, address: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">UPI ID (For QR Fee Collections)</label>
                  <input type="text" className="form-input" value={billingFormData.upiId} onChange={(e) => setBillingFormData(p => ({ ...p, upiId: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Receipt Footer Note</label>
                  <input type="text" className="form-input" value={billingFormData.receiptFooter} onChange={(e) => setBillingFormData(p => ({ ...p, receiptFooter: e.target.value }))} />
                </div>
              </div>

              <button type="submit" className="btn btn-primary">
                <Save size={15} /> Save Billing & Identity Settings
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 4: DATA HUB & TESTING TOOLS */}
      {/* ======================================================== */}
      {activeTab === 'data' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* JSON Backup & Restore Card */}
          <div className="premium-card" style={{ background: 'linear-gradient(135deg, #fff 0%, #eef2ff 100%)', border: '1px solid #c7d2fe', padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#4338ca' }}>
              <Download size={18} color="#6366f1" /><span>Database Backup & Restore</span>
            </h3>
            <p style={{ fontSize: '13px', color: '#4338ca', marginBottom: '16px' }}>
              Export a complete normalized JSON snapshot of all your library configuration, seats, students, and payment records.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={exportDataJSON} style={{ background: '#4f46e5' }}>
                <Download size={15} /> Export JSON Backup
              </button>
              <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0, background: '#fff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>
                <Upload size={15} /> Restore from JSON
                <input type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          {/* 🧪 RANDOM TEST STUDENT GENERATOR (Test Data Only) */}
          <div className="premium-card" style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: '#166534' }}>
                  <Beaker size={18} color="#15803d" /><span>🧪 Random Test Student Generator</span>
                  <span style={{ fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '12px', fontWeight: 700, border: '1px solid #bbf7d0' }}>
                    TEST DATA ONLY
                  </span>
                </h3>
                <p style={{ fontSize: '13px', color: '#15803d', marginTop: '4px', maxWidth: '680px' }}>
                  Generate synthetic student admissions across your <strong>CURRENT</strong> library configuration (branches, sections, seats, shifts, and fee plans) with real transaction records. Never assign overlapping physical seats. Test data can be wiped at any time.
                </p>
              </div>

              {testStudentsCount > 0 && (
                <div style={{ background: '#fff', padding: '6px 12px', borderRadius: '6px', border: '1px solid #86efac', fontSize: '12px', fontWeight: 600, color: '#166534' }}>
                  {testStudentsCount} Test Students in System
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginTop: '16px', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '11px', color: '#166534' }}>Number of Students</label>
                <NumericInput 
                  className="form-input" 
                  style={{ width: '120px', borderColor: '#86efac' }} 
                  value={testStudentCount} 
                  onChange={e => setTestStudentCount(Number(e.target.value))} 
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '11px', color: '#166534' }}>Branch Scope</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', height: '36px' }}>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input 
                      type="radio" 
                      name="testGenScope" 
                      value="all" 
                      checked={testGenScope === 'all'} 
                      onChange={() => setTestGenScope('all')} 
                    />
                    All Eligible Branches
                  </label>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input 
                      type="radio" 
                      name="testGenScope" 
                      value="current" 
                      checked={testGenScope === 'current'} 
                      onChange={() => setTestGenScope('current')} 
                    />
                    Current Active Branch Only
                  </label>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ background: '#16a34a', borderColor: '#15803d' }}
                onClick={handleGenerateTestStudents}
                disabled={isGeneratingTest}
              >
                <Beaker size={15} /> {isGeneratingTest ? 'Generating...' : `Generate ${testStudentCount} Test Students`}
              </button>

              {testStudentsCount > 0 && (
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  style={{ color: '#ef4444', border: '1px solid #fca5a5', background: '#fff' }}
                  onClick={handleClearTestData}
                >
                  <Trash2 size={14} /> Clear Test Data ({testStudentsCount})
                </button>
              )}
            </div>

            {/* Generation Report */}
            {testGenReport && (
              <div style={{ marginTop: '16px', padding: '12px 16px', background: '#fff', borderRadius: '8px', border: '1px solid #86efac' }}>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px', fontWeight: 600 }}>
                  <span style={{ color: '#1e293b' }}>Requested: {testGenReport.requested}</span>
                  <span style={{ color: '#16a34a' }}>✓ Created: {testGenReport.created}</span>
                  {testGenReport.skipped > 0 && (
                    <span style={{ color: '#dc2626' }}>⚠ Skipped: {testGenReport.skipped}</span>
                  )}
                </div>
                {testGenReport.reasons?.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '6px' }}>
                    <strong>Reasons for skipped allocations:</strong>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {testGenReport.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ⚠️ FACTORY RESET (Strongly Protected) */}
          <div className="premium-card" style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#9f1239' }}>
              <AlertTriangle size={18} color="#e11d48" /><span>Factory Reset (Permanent Wiping)</span>
            </h3>
            <p style={{ fontSize: '13px', color: '#9f1239', marginBottom: '14px' }}>
              Destructive operation. Permanently wipes all branches, sections, desks, fee plans, shifts, students, payments, and expenses for "{settings.name || 'Current Library'}".
            </p>
            <button 
              type="button" 
              className="btn btn-ghost" 
              style={{ background: '#fff', border: '1px solid #fca5a5', color: '#e11d48', fontWeight: 600 }}
              onClick={() => setIsResetModalOpen(true)}
            >
              <RefreshCw size={14} /> Open Factory Reset Confirmation
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 5: STAFF MANAGEMENT & ROLE PERMISSION MATRIX */}
      {/* ======================================================== */}
      {activeTab === 'staff' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Top Bar: Title & Add Staff CTA */}
          <div className="premium-card" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <Users size={20} color="#6366f1" />
                <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Staff Management & Permission Control
                </h3>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                Manage staff profiles, assign operational roles, and configure granular action permissions across all library modules.
              </p>
            </div>

            <button 
              id="btn-add-staff"
              type="button" 
              className="btn btn-primary" 
              style={{ background: '#4f46e5', borderColor: '#4338ca', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '8px', fontWeight: 600 }}
              onClick={handleOpenAddStaff}
            >
              <UserPlus size={16} /> Add Staff Member
            </button>
          </div>

          {/* KPI Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div className="premium-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={22} />
              </div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>{staffMembers.length}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Registered Staff Members</div>
              </div>
            </div>

            <div className="premium-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserCheck size={22} />
              </div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#15803d' }}>
                  {staffMembers.filter(s => s.status === 'Active').length}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Active Staff (Allowed Access)</div>
              </div>
            </div>

            <div className="premium-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#fef3c7', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={22} />
              </div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#b45309' }}>
                  {new Set(staffMembers.map(s => s.role)).size}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Configured Roles Active</div>
              </div>
            </div>
          </div>

          {/* Staff Directory Table */}
          <div className="premium-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Staff Directory</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  Click "Set Permissions" on any staff member to view and customize their granular action rights.
                </p>
              </div>
            </div>

            <div className="table-container">
              <table className="data-grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>STAFF MEMBER</th>
                    <th>ROLE</th>
                    <th>BRANCH SCOPE</th>
                    <th>STATUS</th>
                    <th>PERMISSION LEVEL</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {staffMembers.map(st => {
                    const allowedCount = countAllowedActions(st.permissions);
                    const isSelf = currentStaff?.id === st.id;
                    const branchName = st.branchId === 'all' 
                      ? 'All Branches' 
                      : (branches.find(b => b.id === st.branchId)?.name || 'Specific Branch');

                    // Role badge color scheme
                    let roleBadgeStyle = { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
                    if (st.role === 'Admin') roleBadgeStyle = { background: '#f3e8ff', color: '#7e22ce', border: '1px solid #d8b4fe' };
                    else if (st.role === 'Manager') roleBadgeStyle = { background: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' };
                    else if (st.role === 'Librarian') roleBadgeStyle = { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' };
                    else if (st.role === 'Accountant') roleBadgeStyle = { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' };

                    return (
                      <tr key={st.id} style={{ opacity: st.status === 'Inactive' ? 0.65 : 1 }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ 
                              width: '36px', 
                              height: '36px', 
                              borderRadius: '50%', 
                              background: st.role === 'Admin' ? '#e0e7ff' : '#f1f5f9', 
                              color: st.role === 'Admin' ? '#4338ca' : '#475569',
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '14px'
                            }}>
                              {(st.name || 'S').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {st.name}
                                {isSelf && (
                                  <span style={{ fontSize: '10px', background: '#e0e7ff', color: '#4338ca', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                    Current User
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Phone size={11} /> {st.phone}
                                </span>
                                {st.email && (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Mail size={11} /> {st.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span style={{ ...roleBadgeStyle, padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Shield size={12} /> {st.role}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', background: '#f8fafc', padding: '3px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Building2 size={12} color="#64748b" /> {branchName}
                          </span>
                        </td>

                        <td>
                          <button
                            id={`btn-status-${st.id}`}
                            type="button"
                            onClick={() => toggleStaffStatus(st.id)}
                            style={{ 
                              background: st.status === 'Active' ? '#f0fdf4' : '#fef2f2', 
                              color: st.status === 'Active' ? '#15803d' : '#b91c1c', 
                              border: `1px solid ${st.status === 'Active' ? '#bbf7d0' : '#fecaca'}`,
                              padding: '3px 8px', 
                              borderRadius: '6px', 
                              fontSize: '11px', 
                              fontWeight: 700, 
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title="Click to toggle Active / Inactive"
                          >
                            <Power size={11} /> {st.status || 'Active'}
                          </button>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ 
                              fontSize: '11px', 
                              fontWeight: 600,
                              padding: '2px 8px', 
                              borderRadius: '4px', 
                              background: allowedCount > 0 ? '#eff6ff' : '#f1f5f9',
                              color: allowedCount > 0 ? '#1d4ed8' : '#64748b',
                              border: '1px solid #bfdbfe'
                            }}>
                              {allowedCount} / 72 actions
                            </span>
                            <button
                              id={`btn-perm-${st.id}`}
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '11px', color: '#4f46e5', background: '#f5f3ff', border: '1px solid #ddd6fe', padding: '3px 8px', borderRadius: '6px', fontWeight: 600 }}
                              onClick={() => handleOpenPermMatrix(st)}
                            >
                              <ShieldCheck size={12} /> Set Permissions
                            </button>
                          </div>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              id={`btn-edit-${st.id}`}
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '6px', color: '#2563eb' }}
                              title="Edit Staff Member"
                              onClick={() => handleOpenEditStaff(st)}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              id={`btn-delete-${st.id}`}
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '6px', color: '#dc2626' }}
                              title="Delete Staff Member"
                              onClick={() => deleteStaffMember(st.id)}
                              disabled={st.role === 'Admin' && staffMembers.filter(s => s.role === 'Admin').length <= 1}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1: FACTORY RESET CONFIRMATION (TYPE "RESET") */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isResetModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '480px', borderRadius: '12px', border: '1px solid #fecdd3', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#be123c', marginBottom: '12px' }}>
                <AlertTriangle size={24} />
                <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Confirm Factory Reset</h3>
              </div>

              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                This will permanently remove all library data for <strong>"{settings.name || 'Current Library'}"</strong>.
              </p>

              <ul style={{ fontSize: '13px', color: '#be123c', margin: '0 0 16px 20px', padding: 0 }}>
                <li>All branches, sections, and desks will be deleted</li>
                <li>All fee plans, duration tiers, and shifts will be reset</li>
                <li>All students, payments, renewals, and P&L history will be erased</li>
              </ul>

              <div style={{ background: '#eff6ff', padding: '10px 14px', borderRadius: '6px', border: '1px solid #bfdbfe', marginBottom: '16px' }}>
                <span style={{ fontSize: '12px', color: '#1e40af' }}>
                  Recommendation: Export a backup before proceeding.
                </span>
                <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', color: '#1d4ed8', padding: '2px 6px', display: 'block', marginTop: '4px' }} onClick={exportDataJSON}>
                  <Download size={13} /> Export JSON Backup First
                </button>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Type <strong>RESET</strong> in capital letters to confirm:
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="RESET"
                  value={resetConfirmInput}
                  onChange={e => setResetConfirmInput(e.target.value)}
                  style={{ borderColor: resetConfirmInput === 'RESET' ? '#16a34a' : '#cbd5e1' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  onClick={() => { setIsResetModalOpen(false); setResetConfirmInput(''); }}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  style={{ background: '#e11d48', borderColor: '#be123c', opacity: resetConfirmInput === 'RESET' ? 1 : 0.5 }}
                  disabled={resetConfirmInput !== 'RESET'}
                  onClick={handleExecuteFactoryReset}
                >
                  Permanently Reset Library
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL 3: ADD / EDIT STAFF MEMBER */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isStaffModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '520px', borderRadius: '14px', border: '1px solid var(--border-light)', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      {editingStaffId ? 'Edit Staff Member' : 'Add New Staff Member'}
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                      Basic operational details and assigned role.
                    </p>
                  </div>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setIsStaffModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveStaffForm} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Full Name *</label>
                  <input 
                    id="staff-name-input"
                    type="text" 
                    className="form-input" 
                    required 
                    placeholder="e.g. Ramesh Sharma" 
                    value={staffFormData.name} 
                    onChange={e => setStaffFormData(p => ({ ...p, name: e.target.value }))} 
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Contact / Mobile No. *</label>
                    <input 
                      id="staff-phone-input"
                      type="tel" 
                      className="form-input" 
                      required 
                      placeholder="e.g. +91 98765 43210" 
                      value={staffFormData.phone} 
                      onChange={e => setStaffFormData(p => ({ ...p, phone: e.target.value }))} 
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Email Address</label>
                    <input 
                      id="staff-email-input"
                      type="email" 
                      className="form-input" 
                      placeholder="e.g. staff@library.com" 
                      value={staffFormData.email} 
                      onChange={e => setStaffFormData(p => ({ ...p, email: e.target.value }))} 
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Assign Role *</label>
                    <select 
                      id="staff-role-select"
                      className="form-input" 
                      value={staffFormData.role} 
                      onChange={e => setStaffFormData(p => ({ ...p, role: e.target.value }))}
                    >
                      {STAFF_ROLES.map(r => (
                        <option key={r.id} value={r.id}>{r.name} — {r.description}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Branch Scope</label>
                    <select 
                      id="staff-branch-select"
                      className="form-input" 
                      value={staffFormData.branchId} 
                      onChange={e => setStaffFormData(p => ({ ...p, branchId: e.target.value }))}
                    >
                      <option value="all">All Branches</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Operational Status</label>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', height: '36px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="staffStatusRadio" 
                        checked={staffFormData.status === 'Active'} 
                        onChange={() => setStaffFormData(p => ({ ...p, status: 'Active' }))} 
                      />
                      <span style={{ color: '#15803d', fontWeight: 600 }}>Active</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="staffStatusRadio" 
                        checked={staffFormData.status === 'Inactive'} 
                        onChange={() => setStaffFormData(p => ({ ...p, status: 'Inactive' }))} 
                      />
                      <span style={{ color: '#64748b', fontWeight: 500 }}>Inactive</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsStaffModalOpen(false)}>
                    Cancel
                  </button>
                  <button id="btn-save-staff" type="submit" className="btn btn-primary" style={{ background: '#4f46e5', borderColor: '#4338ca' }}>
                    <Save size={15} /> {editingStaffId ? 'Update Staff Details' : 'Save Staff Member'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL 4: GRANULAR PERMISSION MATRIX MODAL */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isPermMatrixModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '880px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', overflow: 'hidden' }}
            >
              {/* Modal Header */}
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={20} color="#4f46e5" />
                    <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Granular Permission Matrix
                    </h3>
                    {(() => {
                      const st = staffMembers.find(s => s.id === targetPermStaffId);
                      return st ? (
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          for <strong>{st.name}</strong> ({st.role})
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    Configure exact operational permissions across all functional modules. Inactive staff are automatically blocked.
                  </p>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setIsPermMatrixModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              {/* Quick Template Presets Bar */}
              <div style={{ padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: '#475569', flexWrap: 'wrap' }}>
                  <span>Presets:</span>
                  {STAFF_ROLES.filter(r => r.id !== 'Custom').map(r => (
                    <button
                      key={r.id}
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '6px', background: '#ffffff', border: '1px solid #cbd5e1', fontWeight: 600, color: '#0f172a', cursor: 'pointer' }}
                      onClick={() => handleApplyRolePreset(r.id)}
                    >
                      {r.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '6px', background: '#ecfdf5', border: '1px solid #a7f3d0', fontWeight: 600, color: '#047857', cursor: 'pointer' }}
                    onClick={() => {
                      const full = {};
                      STAFF_MODULES.forEach(m => {
                        full[m.id] = { view: true, create: true, edit: true, delete: true, approve: true, manage: true };
                      });
                      setTempPermissions(full);
                      toast.success('Granted all permissions');
                    }}
                  >
                    ✓ Grant All
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', fontWeight: 600, color: '#b91c1c', cursor: 'pointer' }}
                    onClick={() => {
                      const none = {};
                      STAFF_MODULES.forEach(m => {
                        none[m.id] = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
                      });
                      setTempPermissions(none);
                      toast.success('Revoked all permissions');
                    }}
                  >
                    ✕ Revoke All
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Filter modules..."
                    value={permSearch}
                    onChange={e => setPermSearch(e.target.value)}
                    style={{ fontSize: '12px', padding: '4px 10px', width: '160px' }}
                  />
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#4338ca', background: '#e0e7ff', padding: '4px 10px', borderRadius: '6px', whiteSpace: 'nowrap' }}>
                    {countAllowedActions(tempPermissions)} of 72 allowed
                  </div>
                </div>
              </div>

              {/* Matrix Scrollable Table */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                <table className="data-grid" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 2 }}>
                      <th style={{ textAlign: 'left', minWidth: '180px', color: '#475569', fontWeight: 700 }}>MODULE</th>
                      {STAFF_ACTIONS.map(act => (
                        <th key={act.id} style={{ textAlign: 'center', fontSize: '11px', minWidth: '70px', textTransform: 'uppercase', color: '#475569', fontWeight: 700 }}>
                          {act.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {STAFF_MODULES.filter(m => !permSearch || m.name.toLowerCase().includes(permSearch.toLowerCase()) || m.description.toLowerCase().includes(permSearch.toLowerCase())).map(mod => {
                      const modPerms = tempPermissions[mod.id] || {};
                      return (
                        <tr key={mod.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '13px' }}>{mod.name}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{mod.description}</div>
                          </td>

                          {/* Individual Action Toggles: View, Create, Edit, Delete, Approve */}
                          {['view', 'create', 'edit', 'delete', 'approve'].map(actId => {
                            const isAllowed = Boolean(modPerms[actId]);
                            return (
                              <td key={actId} style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                <button
                                  id={`perm-toggle-${mod.id}-${actId}`}
                                  type="button"
                                  onClick={() => handleToggleActionPerm(mod.id, actId)}
                                  style={{
                                    border: 'none',
                                    cursor: 'pointer',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    background: isAllowed ? '#dcfce7' : '#f1f5f9',
                                    color: isAllowed ? '#15803d' : '#94a3b8',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    transition: 'all 0.15s ease'
                                  }}
                                  title={`Click to ${isAllowed ? 'deny' : 'allow'} ${actId} on ${mod.name}`}
                                >
                                  {isAllowed ? <Check size={12} strokeWidth={3} /> : <Minus size={12} />}
                                  {isAllowed ? 'Allow' : 'Deny'}
                                </button>
                              </td>
                            );
                          })}

                          {/* Manage All Toggle */}
                          <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                            <button
                              id={`perm-toggle-${mod.id}-manage`}
                              type="button"
                              onClick={() => handleToggleModuleAll(mod.id)}
                              style={{
                                border: 'none',
                                cursor: 'pointer',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: modPerms.manage ? '#e0e7ff' : '#f1f5f9',
                                color: modPerms.manage ? '#4338ca' : '#64748b',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Toggle all actions for this module"
                            >
                              {modPerms.manage ? <ShieldCheck size={12} /> : <Shield size={12} />}
                              {modPerms.manage ? 'All' : 'Custom'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Changes take effect immediately upon saving and persist in the library database.
                </span>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button id="btn-close-perm-modal" type="button" className="btn btn-ghost" onClick={() => setIsPermMatrixModalOpen(false)}>
                    Cancel
                  </button>
                  <button 
                    id="btn-save-permissions"
                    type="button" 
                    className="btn btn-primary" 
                    style={{ background: '#4f46e5', borderColor: '#4338ca', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                    onClick={handleSavePermMatrix}
                  >
                    <Save size={15} /> Save Permissions
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT FEE PLAN (Problem 22) */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isPlanModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}
            >
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingPlanId ? 'Edit Fee Plan' : 'Create New Fee Plan'}
                </h3>
                <button type="button" className="btn btn-ghost" onClick={() => setIsPlanModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePlan} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '20px 24px', gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Plan Name *</label>
                  <input className="form-input" placeholder="e.g. Standard Full Day" value={planName} onChange={e => setPlanName(e.target.value)} required />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Seat Type *</label>
                    <select className="form-select" value={planSeatTypeId} onChange={e => setPlanSeatTypeId(e.target.value)} required>
                      {seatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Section (Optional)</label>
                    <select className="form-select" value={planSectionId} onChange={e => setPlanSectionId(e.target.value)}>
                      <option value="">All Sections in Scope</option>
                      {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Applicable Shifts (Multi-select) *</label>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    {shifts.map(sh => {
                      const checked = planShiftIds.includes(sh.id);
                      return (
                        <label key={sh.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={checked} 
                            onChange={() => {
                              setPlanShiftIds(checked ? planShiftIds.filter(id => id !== sh.id) : [...planShiftIds, sh.id]);
                            }} 
                          />
                          <span>{sh.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Duration Pricing Editor */}
                <div>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Duration Pricing Tiers & Offers</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {planPricing.map((dp, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '70px 1.5fr 1.5fr 1fr auto', gap: '8px', alignItems: 'center', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700 }}>{dp.durationMonths} Mo</span>
                        <NumericInput className="form-input" placeholder="Price (₹)" value={dp.basePrice} onChange={e => {
                          const price = Number(e.target.value);
                          setPlanPricing(planPricing.map((item, i) => i === idx ? { ...item, basePrice: price } : item));
                        }} />
                        <select className="form-select" value={dp.discountType || 'None'} onChange={e => {
                          const dType = e.target.value;
                          setPlanPricing(planPricing.map((item, i) => i === idx ? { ...item, discountType: dType } : item));
                        }}>
                          <option value="None">No Offer</option>
                          <option value="Percentage">% Discount</option>
                          <option value="Fixed">₹ Discount</option>
                        </select>
                        <NumericInput className="form-input" placeholder="Offer" value={dp.discountValue || 0} onChange={e => {
                          const val = Number(e.target.value);
                          setPlanPricing(planPricing.map((item, i) => i === idx ? { ...item, discountValue: val } : item));
                        }} />
                        <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '4px' }} onClick={() => setPlanPricing(planPricing.filter((_, i) => i !== idx))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {[1, 2, 3, 6, 12].filter(m => !planPricing.some(p => p.durationMonths === m)).map(m => (
                        <button
                          key={m}
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '11px', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '4px' }}
                          onClick={() => {
                            setPlanPricing([...planPricing, { durationMonths: m, basePrice: m * 1500, discountType: 'None', discountValue: 0 }].sort((a,b) => a.durationMonths - b.durationMonths));
                          }}
                        >
                          + Add {m} Mo
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsPlanModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary"><Save size={15} /> {editingPlanId ? 'Save Plan' : 'Create Plan'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT SHIFT (Problem 22) */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isShiftModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '500px', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}
            >
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingShiftId ? 'Edit Operating Shift' : 'Add Operating Shift'}
                </h3>
                <button type="button" className="btn btn-ghost" onClick={() => setIsShiftModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveShift} style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Shift Name *</label>
                  <input className="form-input" placeholder="e.g. Morning Focus" value={shiftName} onChange={e => setShiftName(e.target.value)} required />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Start Time *</label>
                    <input type="time" className="form-input" value={shiftStart} onChange={e => setShiftStart(e.target.value)} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>End Time *</label>
                    <input type="time" className="form-input" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} required />
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Operating Days</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {ALL_DAYS.map(d => {
                      const checked = shiftDays.includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          onClick={() => setShiftDays(checked ? shiftDays.filter(day => day !== d) : [...shiftDays, d])}
                          style={{
                            padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                            border: checked ? '1px solid var(--brand-primary)' : '1px solid #cbd5e1',
                            background: checked ? 'var(--brand-primary)' : '#fff',
                            color: checked ? '#fff' : '#64748b'
                          }}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsShiftModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary"><Save size={15} /> {editingShiftId ? 'Save Shift' : 'Add Shift'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT SEAT TYPE (Problem 22) */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isSeatTypeModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '480px', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}
            >
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingSeatTypeId ? 'Edit Seat Type' : 'Add Seat Type'}
                </h3>
                <button type="button" className="btn btn-ghost" onClick={() => setIsSeatTypeModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSeatType} style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Seat Type Name *</label>
                  <input className="form-input" placeholder="e.g. Standard Desk, Cubicle" value={newSeatTypeName} onChange={e => setNewSeatTypeName(e.target.value)} required />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Allocation Mode</label>
                  <select className="form-select" value={newSeatTypeMode} onChange={e => setNewSeatTypeMode(e.target.value)}>
                    <option value="Fixed">Fixed (Assigned physical desk on map)</option>
                    <option value="Non-Fixed">Non-Fixed (Floating capacity)</option>
                  </select>
                </div>

                {newSeatTypeMode === 'Non-Fixed' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Capacity Limit</label>
                      <select className="form-select" value={newSeatTypeCapMode} onChange={e => setNewSeatTypeCapMode(e.target.value)}>
                        <option value="Unlimited">Unlimited</option>
                        <option value="Limited">Limited Max</option>
                      </select>
                    </div>
                    {newSeatTypeCapMode === 'Limited' && (
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Max Students</label>
                        <NumericInput className="form-input" value={newSeatTypeMax} onChange={e => setNewSeatTypeMax(Number(e.target.value))} />
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsSeatTypeModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary"><Save size={15} /> {editingSeatTypeId ? 'Save Seat Type' : 'Add Seat Type'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT SECTION (Problem 22) */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isSectionModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '480px', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}
            >
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingSectionId ? 'Edit Section / Room' : 'Add Section / Room'}
                </h3>
                <button type="button" className="btn btn-ghost" onClick={() => setIsSectionModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSection} style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Section / Room Name *</label>
                  <input className="form-input" placeholder="e.g. Quiet AC Hall, Discussion Zone" value={newSectionName} onChange={e => setNewSectionName(e.target.value)} required />
                </div>

                {branches.length > 0 && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Assigned Branch</label>
                    <select className="form-select" value={newSectionBranchId} onChange={e => setNewSectionBranchId(e.target.value)}>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsSectionModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary"><Save size={15} /> {editingSectionId ? 'Save Section' : 'Add Section'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT BRANCH (Problem 22) */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isBranchModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: '16px' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: '#fff', width: '100%', maxWidth: '480px', borderRadius: '14px', border: '1px solid var(--border-light)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}
            >
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingBranchId ? 'Edit Branch' : 'Add Blank Branch'}
                </h3>
                <button type="button" className="btn btn-ghost" onClick={() => setIsBranchModalOpen(false)} style={{ padding: '6px' }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveBranch} style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Branch Name *</label>
                  <input className="form-input" placeholder="e.g. North Campus" value={newBranchName} onChange={e => setNewBranchName(e.target.value)} required />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Branch Code</label>
                  <input className="form-input" placeholder="e.g. NC" maxLength={4} value={newBranchCode} onChange={e => setNewBranchCode(e.target.value)} />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Address</label>
                  <input className="form-input" placeholder="e.g. 123 Main Road, City" value={newBranchAddress} onChange={e => setNewBranchAddress(e.target.value)} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsBranchModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary"><Save size={15} /> {editingBranchId ? 'Save Branch' : 'Add Branch'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL: SETUP WIZARD (EDIT / RESUME MODE) */}
      {/* ======================================================== */}
      {isSetupWizardOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#fff', overflowY: 'auto' }}>
          <SetupWizard 
            isOpen={true} 
            onClose={() => setIsSetupWizardOpen(false)} 
            isEditMode={true} 
          />
        </div>
      )}

    </motion.div>
  );
};
