import React, { createContext, useContext, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getDefaultPermissionsForRole, syncLegacyPermissions } from '../utils/staffPermissions';

const LibraryContext = createContext();

// Initial Default Demo Data
const INITIAL_SETTINGS = {
  name: "", // Must be explicitly entered in Setup Wizard
  logo: "📖",
  address: "",
  phone: "",
  email: "",
  taxId: "",
  upiId: "",
  upiQrUrl: "",
  receiptFooter: "Thank you for choosing our Library!",
  idProofRequirement: "Required", // 'Required' | 'Can Be Submitted Later' | 'Not Required'
  allowedDocuments: ["Aadhaar Card", "Student ID", "Address Proof", "Photograph"],
  documentTypes: [
    { id: "doc-aadhaar", name: "Aadhaar Card", requirement: "Required", active: true },
    { id: "doc-student-id", name: "Student ID", requirement: "Can Be Submitted Later", active: true },
    { id: "doc-address", name: "Address Proof", requirement: "Can Be Submitted Later", active: true },
    { id: "doc-photo", name: "Photograph", requirement: "Required", active: true },
    { id: "doc-other", name: "Other Document", requirement: "Not Required", active: true }
  ],
  idProofDeadlineDays: 7,
  gracePeriodDays: 3,
  billingMode: "Anniversary", // 'Anniversary' | 'CalendarMonth'
  calendarBillingDay: 1,
  isSetupComplete: false,
  libraryId: "lib-main",
  migrationVersion: 4
};

const INITIAL_SECTIONS = [];
const INITIAL_SEATS = [];
const INITIAL_WAITING_LIST = [];
const INITIAL_BRANCHES = [];

const INITIAL_SEAT_TYPES = [
  { id: "st1", name: "Fixed", branchId: "all", allocationMode: 'Fixed', capacityMode: null, maximumStudentsAllowed: null, libraryId: 'lib-main' },
  { id: "st2", name: "Non-Fixed", branchId: "all", allocationMode: 'Non-Fixed', capacityMode: 'Unlimited', maximumStudentsAllowed: null, libraryId: 'lib-main' }
];

const INITIAL_SHIFTS = [
  { id: "sh1", name: "Full Day", startTime: "06:00", endTime: "20:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], branchId: "all", libraryId: "lib-main", active: true },
  { id: "sh2", name: "Morning", startTime: "06:00", endTime: "12:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], branchId: "all", libraryId: "lib-main", active: true },
  { id: "sh3", name: "Evening", startTime: "14:00", endTime: "20:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], branchId: "all", libraryId: "lib-main", active: true },
  { id: "sh4", name: "Weekend", startTime: "10:00", endTime: "18:00", daysOfWeek: ["Sat", "Sun"], branchId: "all", libraryId: "lib-main", active: true }
];

const INITIAL_PLANS = [
  {
    id: "p1",
    name: "Full Day Plan",
    libraryId: "lib-main",
    branchId: "all",
    sectionId: undefined,
    seatTypeId: "st1",
    shiftIds: ["sh1"],
    durationPricing: [
      { durationMonths: 1, basePrice: 2000, discountType: 'None', discountValue: 0 },
      { durationMonths: 3, basePrice: 6000, discountType: 'Percentage', discountValue: 5 },
      { durationMonths: 6, basePrice: 12000, discountType: 'Percentage', discountValue: 10 },
      { durationMonths: 12, basePrice: 24000, discountType: 'Fixed', discountValue: 2000 }
    ],
    active: true
  },
  {
    id: "p2",
    name: "Half Day Plan",
    libraryId: "lib-main",
    branchId: "all",
    sectionId: undefined,
    seatTypeId: "st1",
    shiftIds: ["sh2", "sh3"],
    durationPricing: [
      { durationMonths: 1, basePrice: 1200, discountType: 'None', discountValue: 0 },
      { durationMonths: 3, basePrice: 3600, discountType: 'Percentage', discountValue: 5 },
      { durationMonths: 6, basePrice: 7200, discountType: 'Percentage', discountValue: 10 },
      { durationMonths: 12, basePrice: 14400, discountType: 'Fixed', discountValue: 1000 }
    ],
    active: true
  }
];

const INITIAL_STAFF = [
  {
    id: "st1",
    name: "Admin User",
    role: "Admin",
    email: "admin@library.com",
    phone: "9876543210",
    status: "Active",
    branchId: "all",
    libraryId: "lib-main",
    createdAt: "2026-09-01",
    permissions: getDefaultPermissionsForRole('Admin')
  }
];

const todayStr = new Date().toISOString().split('T')[0];

const INITIAL_STUDENTS = [];
const INITIAL_EXPENSES = [];
const INITIAL_PAYMENTS = [];
const INITIAL_ARCHIVED_STUDENTS = [];

// Helper: Determine if two shifts overlap in schedule without durationType
export const shiftsOverlap = (shA, shB) => {
  if (!shA || !shB) return false;
  if (shA.id === shB.id) return true;

  // Day intersection check
  const daysA = shA.daysOfWeek || [];
  const daysB = shB.daysOfWeek || [];
  if (daysA.length > 0 && daysB.length > 0) {
    const commonDay = daysA.some(d => daysB.includes(d));
    if (!commonDay) return false;
  }

  // Time overlap check: startA < endB && startB < endA
  if (shA.startTime && shA.endTime && shB.startTime && shB.endTime) {
    return shA.startTime < shB.endTime && shB.startTime < shA.endTime;
  }

  // Fallback: if time metadata is missing/corrupted, FAIL SAFE by treating them as overlapping.
  // Do NOT rely on name matching which allows unsafe double-booking for differently named shifts.
  return true;
};

// Dynamic Reconciliation Helpers (No hardcoded library or entity IDs)
export const reconcileSeatTypes = ({ savedSeatTypes, seats = [], plans = [], students = [], wizardDraft = null, libId = 'lib-main' }) => {
  let draftSeatTypes = [];
  try {
    if (wizardDraft && Array.isArray(wizardDraft.tempSeatTypes)) draftSeatTypes = wizardDraft.tempSeatTypes;
  } catch (e) {}

  const currentMap = new Map();
  (savedSeatTypes || []).forEach(st => {
    if (st && st.id) currentMap.set(st.id, { ...st });
  });

  const referencedMap = new Map();

  // From wizard draft (if any user-configured seat types exist):
  draftSeatTypes.forEach(dst => {
    if (dst && dst.id && dst.id !== 'st1' && dst.id !== 'st2') {
      const allocMode = dst.allocationMode || (dst.name?.toLowerCase().includes('non') ? 'Non-Fixed' : 'Fixed');
      referencedMap.set(dst.id, {
        id: dst.id,
        name: dst.name || 'Fixed',
        allocationMode: allocMode,
        capacityMode: dst.capacityMode || (allocMode === 'Non-Fixed' ? 'Unlimited' : null),
        maximumStudentsAllowed: dst.maximumStudentsAllowed || null,
        branchId: dst.branchId || 'all',
        sectionId: dst.sectionId || dst.blockId || undefined,
        libraryId: dst.libraryId || libId
      });
    }
  });

  // From physical seats:
  (seats || []).forEach(s => {
    if (s && s.seatTypeId) {
      if (!referencedMap.has(s.seatTypeId) && !currentMap.has(s.seatTypeId)) {
        referencedMap.set(s.seatTypeId, {
          id: s.seatTypeId,
          name: 'Fixed',
          allocationMode: 'Fixed',
          capacityMode: null,
          maximumStudentsAllowed: null,
          branchId: s.branchId || 'all',
          sectionId: s.sectionId || undefined,
          libraryId: s.libraryId || libId
        });
      } else if (referencedMap.has(s.seatTypeId)) {
        const entry = referencedMap.get(s.seatTypeId);
        if (!entry.sectionId && s.sectionId) entry.sectionId = s.sectionId;
        if ((!entry.branchId || entry.branchId === 'all') && s.branchId) entry.branchId = s.branchId;
      }
    }
  });

  // From plans:
  (plans || []).forEach(p => {
    if (p && p.seatTypeId && !referencedMap.has(p.seatTypeId) && !currentMap.has(p.seatTypeId)) {
      const isNonFixed = p.name?.toLowerCase().includes('non');
      referencedMap.set(p.seatTypeId, {
        id: p.seatTypeId,
        name: isNonFixed ? 'Non-Fixed' : 'Fixed',
        allocationMode: isNonFixed ? 'Non-Fixed' : 'Fixed',
        capacityMode: isNonFixed ? 'Unlimited' : null,
        maximumStudentsAllowed: null,
        branchId: p.branchId || 'all',
        sectionId: p.sectionId || undefined,
        libraryId: p.libraryId || libId
      });
    }
  });

  // Merge recovered seat types into current map
  referencedMap.forEach((stObj, stId) => {
    if (!currentMap.has(stId)) {
      currentMap.set(stId, stObj);
    } else {
      const existing = currentMap.get(stId);
      if (!existing.sectionId && stObj.sectionId) existing.sectionId = stObj.sectionId;
      if ((!existing.branchId || existing.branchId === 'all') && stObj.branchId) existing.branchId = stObj.branchId;
      if (!existing.allocationMode) existing.allocationMode = stObj.allocationMode;
    }
  });

  // Dynamic pruning of confirmed unreferenced demo templates ('st1', 'st2')
  const allCurrent = Array.from(currentMap.values());
  const hasRealUserSeatTypes = allCurrent.some(st => st.id !== 'st1' && st.id !== 'st2');

  const filtered = allCurrent.filter(st => {
    if (st.id === 'st1' || st.id === 'st2') {
      const seatRef = (seats || []).some(s => s.seatTypeId === st.id);
      const planRef = (plans || []).some(p => p.seatTypeId === st.id);
      const studentRef = (students || []).some(s => s.seatTypeId === st.id);

      if (!seatRef && !planRef && !studentRef && hasRealUserSeatTypes) {
        return false; // Safely prune unreferenced phantom demo default
      }
    }
    return true;
  });

  return filtered.length > 0 ? filtered : INITIAL_SEAT_TYPES;
};

export const reconcileShifts = ({ savedShifts, plans = [], students = [], wizardDraft = null, libId = 'lib-main' }) => {
  let draftShifts = [];
  try {
    if (wizardDraft && Array.isArray(wizardDraft.tempShifts)) draftShifts = wizardDraft.tempShifts;
  } catch (e) {}

  const shiftMap = new Map();
  (savedShifts || []).forEach(sh => {
    const clean = { ...sh, libraryId: sh.libraryId || libId, active: sh.active !== false };
    delete clean.durationType;
    if (!clean.startTime) {
      if (clean.name?.toLowerCase().includes('morning')) {
        clean.startTime = '06:00'; clean.endTime = '12:00'; clean.daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      } else if (clean.name?.toLowerCase().includes('evening')) {
        clean.startTime = '14:00'; clean.endTime = '20:00'; clean.daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      } else if (clean.name?.toLowerCase().includes('weekend')) {
        clean.startTime = '10:00'; clean.endTime = '18:00'; clean.daysOfWeek = ['Sat', 'Sun'];
      } else {
        clean.startTime = '06:00'; clean.endTime = '20:00'; clean.daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      }
    }
    shiftMap.set(clean.id, clean);
  });

  // Restore user shifts from draft if missing
  draftShifts.forEach(dsh => {
    if (dsh && dsh.id && !shiftMap.has(dsh.id)) {
      let sTime = dsh.startTime;
      let eTime = dsh.endTime;
      let days = dsh.daysOfWeek || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      if (!sTime) {
        if (dsh.name?.toLowerCase().includes('morning')) { sTime = '06:00'; eTime = '12:00'; }
        else if (dsh.name?.toLowerCase().includes('evening')) { sTime = '14:00'; eTime = '20:00'; }
        else if (dsh.name?.toLowerCase().includes('weekend')) { sTime = '10:00'; eTime = '18:00'; days = ['Sat', 'Sun']; }
        else { sTime = '06:00'; eTime = '20:00'; days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; }
      }
      shiftMap.set(dsh.id, {
        ...dsh,
        startTime: sTime,
        endTime: eTime,
        daysOfWeek: days,
        libraryId: dsh.libraryId || libId,
        active: dsh.active !== false
      });
    }
  });

  // Dynamic pruning of confirmed unreferenced demo shifts ('sh1'-'sh4')
  const allShifts = Array.from(shiftMap.values());
  const hasUserShifts = allShifts.some(sh => !['sh1', 'sh2', 'sh3', 'sh4'].includes(sh.id));
  const filteredShifts = allShifts.filter(sh => {
    if (['sh1', 'sh2', 'sh3', 'sh4'].includes(sh.id)) {
      const planRef = (plans || []).some(p => p.shiftIds?.includes(sh.id));
      const studentRef = (students || []).some(s => s.shiftId === sh.id || s.shift === sh.name);
      if (!planRef && !studentRef && hasUserShifts) {
        return false; // Safely prune unreferenced demo shift
      }
    }
    return true;
  });

  return filteredShifts.length > 0 ? filteredShifts : INITIAL_SHIFTS;
};

export const reconcilePlans = ({ savedPlans, students = [], archivedStudents = [], wizardDraft = null, libId = 'lib-main' }) => {
  let draftPlans = [];
  try {
    if (wizardDraft && Array.isArray(wizardDraft.tempPlans)) draftPlans = wizardDraft.tempPlans;
  } catch (e) {}

  const planMap = new Map();
  (savedPlans || []).forEach(p => {
    const sIds = p.shiftIds || (p.shiftId ? [p.shiftId] : []);
    let pricing = p.durationPricing;
    if (!pricing || !Array.isArray(pricing) || pricing.length === 0) {
      pricing = [
        {
          durationMonths: p.durationMonths || 1,
          basePrice: p.price !== undefined ? Number(p.price) : 1000,
          discountType: 'None',
          discountValue: 0
        }
      ];
    }
    const cleanPlan = {
      ...p,
      libraryId: p.libraryId || libId,
      shiftIds: sIds,
      durationPricing: pricing,
      active: p.active !== false
    };
    delete cleanPlan.shiftId;
    planMap.set(cleanPlan.id, cleanPlan);
  });

  // Restore user plans from draft if missing
  draftPlans.forEach(dp => {
    if (dp && dp.id && !planMap.has(dp.id)) {
      planMap.set(dp.id, {
        ...dp,
        libraryId: dp.libraryId || libId,
        shiftIds: dp.shiftIds || (dp.shiftId ? [dp.shiftId] : []),
        durationPricing: dp.durationPricing || [
          { durationMonths: dp.durationMonths || 1, basePrice: dp.price || 1500, discountType: 'None', discountValue: 0 }
        ],
        active: dp.active !== false
      });
    }
  });

  // Dynamic pruning of confirmed unreferenced demo plans ('p1', 'p2')
  const allPlans = Array.from(planMap.values());
  const hasUserPlans = allPlans.some(p => p.id !== 'p1' && p.id !== 'p2');
  const filteredPlans = allPlans.filter(p => {
    if (p.id === 'p1' || p.id === 'p2') {
      const studentRef = (students || []).some(s => s.planId === p.id);
      const archivedRef = (archivedStudents || []).some(s => s.planId === p.id);
      if (!studentRef && !archivedRef && hasUserPlans) {
        return false; // Safely prune unreferenced demo plan
      }
    }
    return true;
  });

  return filteredPlans.length > 0 ? filteredPlans : INITIAL_PLANS;
};




export const reconcileSeats = ({ savedSeats, students = [], sections = [], branches = [], seatTypes = [] }) => {
  if (!savedSeats || !Array.isArray(savedSeats)) return [];

  const dedupedSeats = [];
  const seatMap = {};

  const validSections = new Set(sections.map(s => s.id));
  const validSeatTypes = new Set(seatTypes.map(st => st.id));

  // Track physically occupied seat names to ensure we never drop a seat that an active student is sitting in
  const occupiedSeatNames = new Set();
  students.forEach(st => {
    if (st.status === 'Active' && st.seatNo) {
      occupiedSeatNames.add(st.seatNo);
    }
  });

  const defaultSectionId = sections.length > 0 ? sections[0].id : undefined;
  const defaultBranchId = branches && branches.length > 0 ? branches[0].id : undefined;

  savedSeats.forEach(seat => {
    let effectiveSectionId = seat.sectionId;
    if (sections.length > 0) {
      if (!effectiveSectionId || !validSections.has(effectiveSectionId)) {
         effectiveSectionId = defaultSectionId;
      }
    } else {
      effectiveSectionId = undefined;
    }

    // Drop orphans safely (only if they aren't occupied to prevent data loss on broken references)
    if (seat.seatTypeId && !validSeatTypes.has(seat.seatTypeId)) {
      if (!seat.name || !occupiedSeatNames.has(seat.name)) return;
    }

    // Unique fingerprint for a physical desk
    const key = `${seat.branchId || defaultBranchId || 'none'}-${effectiveSectionId || 'none'}-${seat.seatTypeId || 'none'}-${seat.name || seat.seatNumber}`;
    
    const normalizedSeat = {
      ...seat,
      sectionId: effectiveSectionId,
      branchId: seat.branchId || defaultBranchId
    };

    if (!seatMap[key]) {
      seatMap[key] = normalizedSeat;
      dedupedSeats.push(normalizedSeat);
    } else {
      const existing = seatMap[key];
      const existingIsOccupied = existing.name && occupiedSeatNames.has(existing.name);
      const currentIsOccupied = normalizedSeat.name && occupiedSeatNames.has(normalizedSeat.name);
      
      // If the current duplicate is occupied/maintenance but the first one isn't, swap them.
      if (currentIsOccupied || normalizedSeat.isMaintenance || normalizedSeat.isUnavailable) {
        if (!existingIsOccupied && !existing.isMaintenance && !existing.isUnavailable) {
          // Replace the blank duplicate with the functionally significant one
          const index = dedupedSeats.findIndex(s => s.id === existing.id);
          if (index !== -1) {
            dedupedSeats[index] = normalizedSeat;
            seatMap[key] = normalizedSeat;
          }
        }
      }
    }
  });

  return dedupedSeats.length > 0 ? dedupedSeats : [];
};

export const LibraryProvider = ({ children }) => {
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('library_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  });

  const [branches, setBranches] = useState(() => {
    const saved = localStorage.getItem('library_branches');
    return saved ? JSON.parse(saved) : INITIAL_BRANCHES;
  });

  const [activeBranchId, setActiveBranchId] = useState('all');

  const [plans, setPlans] = useState(() => {
    const saved = localStorage.getItem('library_plans');
    const parsed = saved ? JSON.parse(saved) : INITIAL_PLANS;
    const initialStudents = localStorage.getItem('library_students') ? JSON.parse(localStorage.getItem('library_students')) : INITIAL_STUDENTS;
    const initialArchived = localStorage.getItem('library_archived_students') ? JSON.parse(localStorage.getItem('library_archived_students')) : INITIAL_ARCHIVED_STUDENTS;
    let draft = null;
    try { const d = localStorage.getItem('wizardDraft'); if (d) draft = JSON.parse(d); } catch (e) {}
    return reconcilePlans({ savedPlans: parsed, students: initialStudents, archivedStudents: initialArchived, wizardDraft: draft });
  });

  const [staffMembers, setStaffMembers] = useState(() => {
    const saved = localStorage.getItem('library_staff');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(st => ({
            ...st,
            status: st.status || 'Active',
            branchId: st.branchId || 'all',
            libraryId: st.libraryId || 'lib-main',
            permissions: st.permissions?.students ? syncLegacyPermissions(st.permissions) : {
              ...getDefaultPermissionsForRole(st.role || 'Admin'),
              ...st.permissions
            }
          }));
        }
      } catch (e) {}
    }
    return INITIAL_STAFF;
  });


  const [currentStaff, setCurrentStaff] = useState(() => {
    const saved = localStorage.getItem('library_staff');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
      } catch (e) {}
    }
    return INITIAL_STAFF[0];
  });

  const [students, setStudents] = useState(() => {
    const savedBranches = localStorage.getItem('library_branches');
    const parsedBranches = savedBranches ? JSON.parse(savedBranches) : INITIAL_BRANCHES;
    const defaultBranchId = parsedBranches.length > 0 ? parsedBranches[0].id : undefined;

    const savedSections = localStorage.getItem('library_sections');
    const parsedSections = savedSections ? JSON.parse(savedSections) : INITIAL_SECTIONS;
    const defaultSecId = parsedSections.length > 0 ? parsedSections[0].id : undefined;

    const saved = localStorage.getItem('library_students');
    let parsed = saved ? JSON.parse(saved) : INITIAL_STUDENTS;
    parsed = parsed.map(s => ({
      ...s,
      branchId: s.branchId || defaultBranchId,
      sectionId: s.sectionId || defaultSecId
    }));
    return parsed;
  });

  const [expenses, setExpenses] = useState(() => {
    const saved = localStorage.getItem('library_expenses');
    return saved ? JSON.parse(saved) : INITIAL_EXPENSES;
  });

  const [payments, setPayments] = useState(() => {
    const saved = localStorage.getItem('library_payments');
    return saved ? JSON.parse(saved) : INITIAL_PAYMENTS;
  });

  const [seatTypes, setSeatTypes] = useState(() => {
    const saved = localStorage.getItem('library_seat_types');
    const parsed = saved ? JSON.parse(saved) : INITIAL_SEAT_TYPES;
    const initialSeats = localStorage.getItem('library_seats') ? JSON.parse(localStorage.getItem('library_seats')) : INITIAL_SEATS;
    const initialPlans = localStorage.getItem('library_plans') ? JSON.parse(localStorage.getItem('library_plans')) : INITIAL_PLANS;
    const initialStudents = localStorage.getItem('library_students') ? JSON.parse(localStorage.getItem('library_students')) : INITIAL_STUDENTS;
    let draft = null;
    try { const d = localStorage.getItem('wizardDraft'); if (d) draft = JSON.parse(d); } catch (e) {}
    return reconcileSeatTypes({ savedSeatTypes: parsed, seats: initialSeats, plans: initialPlans, students: initialStudents, wizardDraft: draft });
  });

  const [shifts, setShifts] = useState(() => {
    const saved = localStorage.getItem('library_shifts');
    const parsed = saved ? JSON.parse(saved) : INITIAL_SHIFTS;
    const initialPlans = localStorage.getItem('library_plans') ? JSON.parse(localStorage.getItem('library_plans')) : INITIAL_PLANS;
    const initialStudents = localStorage.getItem('library_students') ? JSON.parse(localStorage.getItem('library_students')) : INITIAL_STUDENTS;
    let draft = null;
    try { const d = localStorage.getItem('wizardDraft'); if (d) draft = JSON.parse(d); } catch (e) {}
    return reconcileShifts({ savedShifts: parsed, plans: initialPlans, students: initialStudents, wizardDraft: draft });
  });

  const [archivedStudents, setArchivedStudents] = useState(() => {
    const saved = localStorage.getItem('library_archived_students');
    return saved ? JSON.parse(saved) : INITIAL_ARCHIVED_STUDENTS;
  });

  const [sections, setSections] = useState(() => {
    const saved = localStorage.getItem('library_sections');
    return saved ? JSON.parse(saved) : INITIAL_SECTIONS;
  });

  const [seats, setSeats] = useState(() => {
    const saved = localStorage.getItem('library_seats');
    const parsed = saved ? JSON.parse(saved) : INITIAL_SEATS;
    const initialStudents = localStorage.getItem('library_students') ? JSON.parse(localStorage.getItem('library_students')) : INITIAL_STUDENTS;
    const initialSections = localStorage.getItem('library_sections') ? JSON.parse(localStorage.getItem('library_sections')) : INITIAL_SECTIONS;
    const initialBranches = localStorage.getItem('library_branches') ? JSON.parse(localStorage.getItem('library_branches')) : INITIAL_BRANCHES;
    const initialSeatTypes = localStorage.getItem('library_seat_types') ? JSON.parse(localStorage.getItem('library_seat_types')) : INITIAL_SEAT_TYPES;
    return reconcileSeats({ savedSeats: parsed, students: initialStudents, sections: initialSections, branches: initialBranches, seatTypes: initialSeatTypes });
  });

  const [waitingList, setWaitingList] = useState(() => {
    const saved = localStorage.getItem('library_waiting_list');
    return saved ? JSON.parse(saved) : INITIAL_WAITING_LIST;
  });

  // LocalStorage Persist with Safe Error Catching
  const safeSetItem = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`[STORAGE] Could not persist key "${key}":`, e);
    }
  };

  useEffect(() => { safeSetItem('library_settings', settings); }, [settings]);
  useEffect(() => { safeSetItem('library_branches', branches); }, [branches]);
  useEffect(() => {
    safeSetItem('library_staff', staffMembers);
    if (currentStaff) {
      const updated = staffMembers.find(st => st.id === currentStaff.id);
      if (updated) {
        setCurrentStaff(updated);
      } else if (staffMembers.length > 0) {
        setCurrentStaff(staffMembers[0]);
      }
    }
  }, [staffMembers]);
  useEffect(() => { safeSetItem('library_expenses', expenses); }, [expenses]);
  useEffect(() => { safeSetItem('library_payments', payments); }, [payments]);
  useEffect(() => { safeSetItem('library_shifts', shifts); }, [shifts]);
  useEffect(() => { safeSetItem('library_archived_students', archivedStudents); }, [archivedStudents]);
  useEffect(() => { safeSetItem('library_sections', sections); }, [sections]);
  useEffect(() => { safeSetItem('library_seats', seats); }, [seats]);
  useEffect(() => { safeSetItem('library_seat_types', seatTypes); }, [seatTypes]);
  useEffect(() => { safeSetItem('library_plans', plans); }, [plans]);
  useEffect(() => { 
    console.log('[DIAGNOSTIC] students array length:', students.length);
    try {
      const stringified = JSON.stringify(students);
      console.log('[DIAGNOSTIC] JSON.stringify successful. Length:', stringified.length);
      localStorage.setItem('library_students', stringified);
      console.log('[DIAGNOSTIC] Successfully wrote to localStorage. Reading back: ', localStorage.getItem('library_students') ? 'EXISTS' : 'MISSING');
    } catch (error) {
      console.error('[DIAGNOSTIC] JSON.stringify FAILED!', error);
      // Find the exact object/field causing the issue
      students.forEach((student, i) => {
        try {
          JSON.stringify(student);
        } catch (e) {
          console.error(`[DIAGNOSTIC] Failed at student index ${i} (ID: ${student.id})`, e);
          for (const key in student) {
            try {
              JSON.stringify(student[key]);
            } catch (fieldError) {
              console.error(`[DIAGNOSTIC] Exact field failing: "${key}" in student ${student.id}`, fieldError);
            }
          }
        }
      });
    }
  }, [students]);
  useEffect(() => { console.log('[EFFECT] waitingList'); localStorage.setItem('library_waiting_list', JSON.stringify(waitingList)); }, [waitingList]);

  // Safe Non-Destructive Data Migration (v3)
  useEffect(() => {
    let libId = settings.libraryId || `lib-${Date.now()}`;

    let draft = null;
    try {
      const draftStr = localStorage.getItem('wizardDraft');
      if (draftStr) draft = JSON.parse(draftStr);
    } catch (e) {}

    // 1. Dynamic Seat Types Reconciliation & Recovery
    setSeatTypes(prev => reconcileSeatTypes({ savedSeatTypes: prev, seats, plans, students, wizardDraft: draft, libId }));

    // 2. Migrate Shifts: ensure startTime, endTime, daysOfWeek, active, and prune unreferenced phantoms
    setShifts(prev => reconcileShifts({ savedShifts: prev, plans, students, wizardDraft: draft, libId }));

    // 3. Migrate Plans: ensure shiftIds: string[] and durationPricing: [] and prune unreferenced phantoms
    setPlans(prev => reconcilePlans({ savedPlans: prev, students, archivedStudents, wizardDraft: draft, libId }));

    // Ensure settings migration version (v4)
    if (settings.migrationVersion !== 4 || !settings.libraryId || !settings.documentTypes) {
      setSettings(prev => ({
        ...prev,
        libraryId: libId,
        migrationVersion: 4,
        idProofRequirement: prev.idProofRequirement || 'Required',
        allowedDocuments: prev.allowedDocuments || ["Aadhaar Card", "Student ID", "Address Proof", "Photograph"],
        documentTypes: prev.documentTypes && prev.documentTypes.length > 0 ? prev.documentTypes : [
          { id: "doc-aadhaar", name: "Aadhaar Card", requirement: "Required", active: true },
          { id: "doc-student-id", name: "Student ID", requirement: "Can Be Submitted Later", active: true },
          { id: "doc-address", name: "Address Proof", requirement: "Can Be Submitted Later", active: true },
          { id: "doc-photo", name: "Photograph", requirement: "Required", active: true },
          { id: "doc-other", name: "Other Document", requirement: "Not Required", active: true }
        ]
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ID Generators
  const generateStudentId = (branchId, transientStudents = []) => {
    const branch = branches.find(b => b.id === branchId) || branches[0];
    const code = branch?.code || "LIB";
    
    const allStudents = [...students, ...transientStudents];
    let maxId = 1000; // Base start
    
    allStudents.forEach(s => {
      if (s.id && s.id.includes(`-${code}-`)) {
        const parts = s.id.split('-');
        const numPart = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(numPart) && numPart > maxId) {
          maxId = numPart;
        }
      }
    });
    
    return `STU-${code}-${maxId + 1}`;
  };

  const generateReceiptNo = (transientPayments = []) => {
    const year = new Date().getFullYear();
    const allPayments = [...payments, ...transientPayments];
    
    let maxCount = 0;
    allPayments.forEach(p => {
      if (p.receiptNo && p.receiptNo.includes(`-${year}-`)) {
        const parts = p.receiptNo.split('-');
        const numPart = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(numPart) && numPart > maxCount) {
          maxCount = numPart;
        }
      }
    });
    
    const count = String(maxCount + 1).padStart(3, '0');
    return `REC-${year}-${count}`;
  };

  // --- Central Source of Truth Helpers ---

  const resolveScope = (libId, branchId, sectionId, seatTypeId) => {
    const st = seatTypes.find(s => s.id === seatTypeId);
    if (!st || (libId && st.libraryId && st.libraryId !== libId)) return false;
    if (st.branchId && st.branchId !== 'all' && branchId && branchId !== 'all' && st.branchId !== branchId) return false;
    if (st.sectionId && sectionId && sectionId !== 'all' && st.sectionId !== sectionId) return false;
    return true;
  };

  const getEligibleSeatTypes = (libId, branchId, sectionId) => {
    return seatTypes.filter(st => {
      if (libId && st.libraryId && st.libraryId !== libId) return false;
      if (branchId && branchId !== 'all' && st.branchId && st.branchId !== 'all' && st.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && st.sectionId && st.sectionId !== sectionId) return false;
      return true;
    });
  };

  // Check seat occupancy status using schedules
  const getSeatOccupancyStatus = (libId, branchId, sectionId, seatName, requestedShiftId, transientStudents = [], excludeStudentId = null) => {
    if (!seatName || seatName === 'Non-Fixed Seat' || seatName === 'None') return null;

    const reqShiftObj = shifts.find(sh => sh.id === requestedShiftId);

    const allStudents = [...students, ...transientStudents];
    for (const s of allStudents) {
      if (excludeStudentId && s.id === excludeStudentId) continue;
      if (libId && s.libraryId && s.libraryId !== libId) continue;
      if (s.seatNo === 'Non-Fixed Seat' || s.seatNo === 'None') continue;
      if (branchId && branchId !== 'all' && s.branchId && s.branchId !== 'all' && s.branchId !== branchId) continue;
      if (sectionId && sectionId !== 'all' && s.sectionId && s.sectionId !== sectionId) continue;

      if (s.seatNo === seatName) {
        if (s.status !== 'Active' && s.status !== 'Expiring Soon') continue;

        // Found active occupant of this physical seat
        if (!requestedShiftId) {
          return s;
        }

        const studentShift = shifts.find(sh => sh.id === s.shiftId) || { id: s.shiftId, name: s.shift };
        if (reqShiftObj) {
          if (shiftsOverlap(studentShift, reqShiftObj)) {
            return s;
          }
        } else {
          return s;
        }
      }
    }
    return null;
  };

  const getBlockOccupancyMap = (branchId, sectionId, shiftId) => {
    const map = { fixed: {}, nonFixed: [] };
    const reqShiftObj = shifts.find(sh => sh.id === shiftId);

    students.forEach(s => {
      if (branchId && branchId !== 'all' && s.branchId && s.branchId !== 'all' && s.branchId !== branchId) return;
      if (sectionId && sectionId !== 'all' && s.sectionId && s.sectionId !== sectionId) return;
      if (s.status !== 'Active' && s.status !== 'Expiring Soon') return;

      const studentShift = shifts.find(sh => sh.id === s.shiftId) || { id: s.shiftId, name: s.shift };
      const overlaps = reqShiftObj ? shiftsOverlap(studentShift, reqShiftObj) : true;

      if (overlaps) {
        if (s.seatNo === 'Non-Fixed Seat' || s.seatNo === 'None') {
          map.nonFixed.push(s);
        } else {
          map.fixed[s.seatNo] = s;
        }
      }
    });
    return map;
  };

  const getCurrentActiveAdmissions = (libId, branchId, sectionId, seatTypeId, shiftId, transientStudents = []) => {
    const reqShiftObj = shifts.find(sh => sh.id === shiftId);

    const allStudents = [...students, ...transientStudents];
    return allStudents.filter(s => {
      if (libId && s.libraryId && s.libraryId !== libId) return false;
      if (s.status !== 'Active' && s.status !== 'Expiring Soon') return false;
      if (seatTypeId && s.seatTypeId !== seatTypeId) return false;
      if (branchId && branchId !== 'all' && s.branchId && s.branchId !== 'all' && s.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && s.sectionId && s.sectionId !== sectionId) return false;

      if (!shiftId) return true;
      const studentShift = shifts.find(sh => sh.id === s.shiftId) || { id: s.shiftId, name: s.shift };
      return reqShiftObj ? shiftsOverlap(studentShift, reqShiftObj) : (s.shiftId === shiftId);
    }).length;
  };

  const getAvailableEligibleSeats = (libId, branchId, sectionId, seatTypeId, shiftId, transientStudents = []) => {
    if (!seatTypeId) return [];

    return seats.filter(seat => {
      if (libId && seat.libraryId && seat.libraryId !== libId) return false;
      if (branchId && branchId !== 'all' && seat.branchId && seat.branchId !== 'all' && seat.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && seat.sectionId && seat.sectionId !== sectionId) return false;
      if (seat.seatTypeId !== seatTypeId) return false;
      if (seat.isMaintenance || seat.isUnavailable) return false;

      const seatIdentifier = seat.name || seat.seatNumber;
      if (!seatIdentifier) return false; // Invalid seat data
      const occupant = getSeatOccupancyStatus(libId, branchId, sectionId, seatIdentifier, shiftId, transientStudents);
      return !occupant;
    });
  };

  const canAdmitStudent = (libId, branchId, sectionId, seatTypeId, shiftId, specificSeatName = null, transientStudents = []) => {
    const st = seatTypes.find(s => s.id === seatTypeId);
    if (!st) return { allowed: false, reason: "Invalid Seat Type" };

    if (st.allocationMode === 'Fixed') {
      if (specificSeatName) {
        // 1. Verify seat actually exists in this branch & section
        const seatObj = seats.find(s => 
          s.name === specificSeatName && 
          (!branchId || branchId === 'all' || !s.branchId || s.branchId === 'all' || s.branchId === branchId) &&
          (!sectionId || sectionId === 'all' || !s.sectionId || s.sectionId === 'all' || s.sectionId === sectionId)
        );
        if (!seatObj) {
          return { allowed: false, reason: `Desk "${specificSeatName}" does not exist in the configured seat map.` };
        }
        // 2. Verify maintenance / unavailable status
        if (seatObj.isMaintenance || seatObj.isUnavailable) {
          return { allowed: false, reason: `Desk "${specificSeatName}" is currently ${seatObj.isMaintenance ? 'under maintenance' : 'unavailable'}.` };
        }
        // 3. Verify maximum ONE active student occupancy during this shift
        const occupant = getSeatOccupancyStatus(libId, branchId, sectionId, specificSeatName, shiftId, transientStudents);
        if (occupant) return { allowed: false, reason: `Seat ${specificSeatName} is occupied by ${occupant.name}.` };
        return { allowed: true };
      } else {
        const availableSeats = getAvailableEligibleSeats(libId, branchId, sectionId, seatTypeId, shiftId, transientStudents);
        if (availableSeats.length === 0) return { allowed: false, reason: "No available physical seats for this shift." };
        return { allowed: true };
      }
    } else {
      if (st.capacityMode === 'Unlimited') return { allowed: true };
      const activeCount = getCurrentActiveAdmissions(libId, branchId, sectionId, seatTypeId, shiftId, transientStudents);
      const maxAllowed = st.maximumStudentsAllowed || 0;
      if (activeCount >= maxAllowed) {
        return { allowed: false, reason: `Capacity full (${activeCount}/${maxAllowed} active students).` };
      }
      return { allowed: true };
    }
  };

  // Find matching Plans for a given Section, Seat Type, and Shift
  const getMatchingPlans = (libId, branchId, sectionId, seatTypeId, shiftId) => {
    return plans.filter(p => {
      if (!p.active) return false;
      if (libId && p.libraryId && p.libraryId !== libId) return false;
      if (branchId && branchId !== 'all' && p.branchId && p.branchId !== 'all' && p.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && p.sectionId && p.sectionId !== 'all' && p.sectionId !== sectionId) return false;
      // Requirement #9: "Seat: Any" must NOT bypass seat type relationship. Every plan must explicitly match a valid seat type!
      if (!p.seatTypeId) return false;
      if (seatTypeId && p.seatTypeId !== seatTypeId) return false;
      if (shiftId) {
        if (!p.shiftIds || p.shiftIds.length === 0 || !p.shiftIds.includes(shiftId)) return false;
      }
      return true;
    });
  };

  // Valid shifts for a plan
  const getValidShiftsForPlan = (plan) => {
    if (!plan || !plan.shiftIds) return [];
    return shifts.filter(sh => sh.active !== false && plan.shiftIds.includes(sh.id));
  };

  // Valid desks list for branch / section
  const getValidDesksList = (branchId, sectionId) => {
    return seats
      .filter(s => (!branchId || s.branchId === branchId) && (!sectionId || s.sectionId === sectionId))
      .map(s => s.name);
  };

  // Unsynced shifts: active shifts not connected to any active plan
  const getUnsyncedShifts = () => {
    const activePlans = plans.filter(p => p.active !== false);
    return shifts.filter(sh => {
      if (sh.active === false) return false;
      const connected = activePlans.some(p => p.shiftIds && p.shiftIds.includes(sh.id));
      return !connected;
    });
  };

  // Unsynced plans: active plans with no active shifts assigned
  const getUnsyncedPlans = () => {
    const activeShifts = shifts.filter(sh => sh.active !== false);
    return plans.filter(p => {
      if (p.active === false) return false;
      if (!p.shiftIds || p.shiftIds.length === 0) return true;
      const hasActiveShift = p.shiftIds.some(sId => activeShifts.some(sh => sh.id === sId));
      return !hasActiveShift;
    });
  };

  // Waiting List
  const addToWaitingList = (waitlistEntry) => {
    const entry = {
      id: `wl-${Date.now()}`,
      requestedAt: new Date().toISOString(),
      priority: waitingList.length + 1,
      status: 'WAITING',
      ...waitlistEntry
    };
    setWaitingList(prev => [...prev, entry]);
    return entry.id;
  };

  const getEligibleWaitingStudents = (libId, branchId, sectionId, seatTypeId, shiftId) => {
    return waitingList.filter(wl => {
      if (wl.status !== 'WAITING') return false;
      if (libId && wl.libraryId && wl.libraryId !== libId) return false;
      if (branchId && branchId !== 'all' && wl.branchId && wl.branchId !== 'all' && wl.branchId !== branchId) return false;
      if (sectionId && sectionId !== 'all' && wl.sectionId && wl.sectionId !== 'all' && wl.sectionId !== sectionId) return false;
      if (seatTypeId && wl.seatTypeId && wl.seatTypeId !== seatTypeId) return false;
      if (shiftId && wl.shiftId && wl.shiftId !== shiftId) return false;
      return true;
    }).sort((a, b) => a.priority - b.priority);
  };

  const removeFromWaitingList = (entryId) => {
    setWaitingList(prev => prev.filter(w => w.id !== entryId && w.studentId !== entryId));
  };

  const updateWaitingListStatus = (entryId, newStatus, additionalData = {}) => {
    setWaitingList(prev => prev.map(w => {
      if (w.id === entryId) {
        const now = new Date().toISOString();
        const updates = { 
          ...w, 
          status: newStatus, 
          lastStatusChangeDate: now,
          ...additionalData 
        };
        if (newStatus === 'OFFERED') updates.offeredDate = now;
        if (newStatus === 'ADMITTED') updates.admittedDate = now;
        if (newStatus === 'CANCELLED') updates.cancelledDate = now;
        if (newStatus === 'EXPIRED') updates.resolvedAt = now;
        return updates;
      }
      return w;
    }));
  };

  // Safe Deletion Validations
  const canDeleteShift = (shiftId) => {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return { allowed: false, reason: "Shift not found." };
    const enrolledStudents = students.filter(s => (s.status === 'Active' || s.status === 'Expiring Soon') && s.shiftId === shiftId);
    if (enrolledStudents.length > 0) {
      return { allowed: false, reason: `Cannot delete: Assigned to ${enrolledStudents.length} active student(s).` };
    }
    const referencedPlans = plans.filter(p => p.active && p.shiftIds && p.shiftIds.includes(shiftId));
    if (referencedPlans.length > 0) {
      return { allowed: false, reason: `Cannot delete: Referenced by plan(s) (${referencedPlans.map(p => p.name).join(', ')}). Remove it from plans first.` };
    }
    return { allowed: true };
  };

  const canDeletePlan = (planId) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return { allowed: false, reason: "Plan not found." };
    const enrolled = students.filter(s => (s.status === 'Active' || s.status === 'Expiring Soon') && s.planId === planId);
    if (enrolled.length > 0) {
      return { allowed: false, reason: `Cannot delete: Assigned to ${enrolled.length} active student(s).` };
    }
    return { allowed: true };
  };

  const canDeleteSeat = (seatId) => {
    const seat = seats.find(s => s.id === seatId);
    if (!seat) return { allowed: false, reason: "Seat not found." };
    const occupant = getSeatOccupancyStatus(seat.libraryId, seat.branchId, seat.sectionId, seat.name, null);
    if (occupant) {
      return { allowed: false, reason: `Cannot delete: Occupied by ${occupant.name}. Relocate the student first.` };
    }
    return { allowed: true };
  };

  const canDeleteSection = (sectionId) => {
    const sec = sections.find(s => s.id === sectionId);
    if (!sec) return { allowed: false, reason: "Section not found." };
    const secSeats = seats.filter(s => s.sectionId === sectionId);
    const occupiedSeat = secSeats.find(s => getSeatOccupancyStatus(s.libraryId, s.branchId, s.sectionId, s.name, null));
    if (occupiedSeat) {
      return { allowed: false, reason: "Cannot delete section: Contains occupied seats." };
    }
    const enrolled = students.filter(s => (s.status === 'Active' || s.status === 'Expiring Soon') && s.sectionId === sectionId);
    if (enrolled.length > 0) {
      return { allowed: false, reason: `Cannot delete: ${enrolled.length} active student(s) enrolled in this section.` };
    }
    return { allowed: true };
  };

  const canDeleteSeatType = (seatTypeId) => {
    const st = seatTypes.find(s => s.id === seatTypeId);
    if (!st) return { allowed: false, reason: "Seat Type not found." };
    const enrolled = students.filter(s => (s.status === 'Active' || s.status === 'Expiring Soon') && s.seatTypeId === seatTypeId);
    if (enrolled.length > 0) {
      return { allowed: false, reason: `Cannot delete: Assigned to ${enrolled.length} active student(s).` };
    }
    return { allowed: true };
  };

  // Branch Cloning Utility
  const copyFromBranch = (sourceBranchId, targetName, targetCode, targetAddress = "") => {
    const sourceBranch = branches.find(b => b.id === sourceBranchId);
    if (!sourceBranch) return null;

    const newBranchId = `b-${Date.now()}`;
    const cleanCode = (targetCode || targetName.slice(0, 3).toUpperCase() || `B${branches.length + 1}`).slice(0, 4).toUpperCase();
    const newBranch = {
      id: newBranchId,
      name: targetName,
      code: cleanCode,
      address: targetAddress,
      libraryId: settings.libraryId,
      active: true
    };

    // ID Mapping dicts
    const sectionMap = {};
    const seatTypeMap = {};
    const shiftMap = {};

    // Clone sections
    const sourceSections = sections.filter(s => s.branchId === sourceBranchId);
    const newSections = sourceSections.map(sec => {
      const newSecId = `sec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      sectionMap[sec.id] = newSecId;
      return {
        ...sec,
        id: newSecId,
        branchId: newBranchId,
        libraryId: settings.libraryId
      };
    });

    // Clone seat types
    const sourceSeatTypes = seatTypes.filter(st => st.branchId === sourceBranchId || st.branchId === 'all');
    const newSeatTypes = sourceSeatTypes.map(st => {
      const newStId = `st-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      seatTypeMap[st.id] = newStId;
      return {
        ...st,
        id: newStId,
        branchId: newBranchId,
        sectionId: st.sectionId ? sectionMap[st.sectionId] : undefined,
        libraryId: settings.libraryId
      };
    });

    // Clone shifts
    const sourceShifts = shifts.filter(sh => sh.branchId === sourceBranchId || sh.branchId === 'all');
    const newShifts = sourceShifts.map(sh => {
      const newShId = `sh-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      shiftMap[sh.id] = newShId;
      return {
        ...sh,
        id: newShId,
        branchId: newBranchId,
        libraryId: settings.libraryId
      };
    });

    // Clone plans with remapped shiftIds, sectionId, seatTypeId
    const sourcePlans = plans.filter(p => p.branchId === sourceBranchId || p.branchId === 'all');
    const newPlans = sourcePlans.map(p => {
      const newPlanId = `pl-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const remappedShiftIds = (p.shiftIds || []).map(sId => shiftMap[sId] || sId);
      return {
        ...p,
        id: newPlanId,
        branchId: newBranchId,
        sectionId: p.sectionId ? sectionMap[p.sectionId] : undefined,
        seatTypeId: p.seatTypeId ? seatTypeMap[p.seatTypeId] : undefined,
        shiftIds: remappedShiftIds,
        libraryId: settings.libraryId
      };
    });

    // Clone physical seats
    const sourceSeats = seats.filter(s => s.branchId === sourceBranchId);
    const newSeats = sourceSeats.map(s => {
      return {
        ...s,
        id: `seat-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        branchId: newBranchId,
        sectionId: s.sectionId ? sectionMap[s.sectionId] : undefined,
        seatTypeId: s.seatTypeId ? seatTypeMap[s.seatTypeId] : undefined,
        libraryId: settings.libraryId,
        isMaintenance: false,
        isUnavailable: false
      };
    });

    setBranches(prev => [...prev, newBranch]);
    if (newSections.length > 0) setSections(prev => [...prev, ...newSections]);
    if (newSeatTypes.length > 0) setSeatTypes(prev => [...prev, ...newSeatTypes]);
    if (newShifts.length > 0) setShifts(prev => [...prev, ...newShifts]);
    if (newPlans.length > 0) setPlans(prev => [...prev, ...newPlans]);
    if (newSeats.length > 0) setSeats(prev => [...prev, ...newSeats]);

    return newBranch;
  };

  // Comprehensive Data Integrity Auditing
  const checkDataIntegrity = () => {
    const issues = [];
    const libId = settings.libraryId;

    // 1. Unsynced Shifts (active shifts not connected to any active plan)
    const unsyncedSh = getUnsyncedShifts();
    unsyncedSh.forEach(sh => {
      issues.push({
        issueType: 'UNSYNCED_SHIFT',
        type: 'warning',
        category: 'shift',
        id: sh.id,
        recordId: sh.id,
        recordName: sh.name,
        libraryId: sh.libraryId || libId,
        branchId: sh.branchId,
        sectionId: sh.sectionId,
        message: `Shift "${sh.name}" (Branch: ${branches.find(b => b.id === sh.branchId)?.name || 'All'}) is not connected to any plan. Assign it to a plan or delete/deactivate the shift.`,
        actionLabel: 'Assign to Plan',
        actionType: 'ASSIGN_SHIFT_TO_PLAN',
        targetTab: 'settings',
        targetSection: 'plans'
      });
    });

    // 2. Unsynced Plans (active plans with no active shifts assigned)
    const unsyncedPl = getUnsyncedPlans();
    unsyncedPl.forEach(p => {
      issues.push({
        issueType: 'UNSYNCED_PLAN',
        type: 'warning',
        category: 'plan',
        id: p.id,
        recordId: p.id,
        recordName: p.name,
        libraryId: p.libraryId || libId,
        branchId: p.branchId,
        sectionId: p.sectionId,
        message: `Plan "${p.name}" (Branch: ${branches.find(b => b.id === p.branchId)?.name || 'All'}) has no valid applicable shifts assigned.`,
        actionLabel: 'Edit Plan Shifts',
        actionType: 'EDIT_PLAN_SHIFTS',
        targetTab: 'settings',
        targetSection: 'plans'
      });
    });

    // 3. Students exceeding non-fixed capacity
    students.forEach(s => {
      if (s.status !== 'Active' && s.status !== 'Expiring Soon') return;
      const st = seatTypes.find(t => t.id === s.seatTypeId);
      if (st && st.allocationMode === 'Non-Fixed' && st.capacityMode === 'Limited') {
        const activeCount = getCurrentActiveAdmissions(libId, s.branchId, s.sectionId, s.seatTypeId, s.shiftId);
        const max = st.maximumStudentsAllowed || 0;
        if (activeCount > max && !issues.some(iss => iss.recordId === st.id && iss.issueType === 'CAPACITY_OVERFLOW')) {
          issues.push({
            issueType: 'CAPACITY_OVERFLOW',
            type: 'error',
            category: 'capacity',
            id: st.id,
            recordId: st.id,
            recordName: st.name,
            libraryId: st.libraryId || libId,
            branchId: st.branchId,
            sectionId: st.sectionId,
            message: `Capacity exceeded for "${st.name}" (Branch: ${branches.find(b => b.id === st.branchId)?.name || 'All'}) (${activeCount}/${max} students active). Action required.`,
            actionLabel: 'Adjust Capacity',
            actionType: 'EDIT_SEAT_TYPE',
            targetTab: 'settings',
            targetSection: 'seat-types'
          });
        }
      }
    });

    // 4. Seats with missing seat types
    seats.forEach(s => {
      if (!seatTypes.some(st => st.id === s.seatTypeId)) {
        if (!issues.some(iss => iss.recordId === s.id && iss.issueType === 'SEAT_MISSING_TYPE')) {
          issues.push({
            issueType: 'SEAT_MISSING_TYPE',
            type: 'error',
            category: 'seat',
            id: s.id,
            recordId: s.id,
            recordName: s.name,
            libraryId: s.libraryId || libId,
            branchId: s.branchId,
            sectionId: s.sectionId,
            message: `Seat "${s.name}" (Branch: ${branches.find(b => b.id === s.branchId)?.name || 'All'}) references an unknown seat type.`,
            actionLabel: 'Configure Seat Types',
            actionType: 'EDIT_SEAT_TYPE',
            targetTab: 'settings',
            targetSection: 'seat-types'
          });
        }
      }
    });

    // 5. Plans with missing or unknown seat types
    plans.forEach(p => {
      if (!p.seatTypeId || !seatTypes.some(st => st.id === p.seatTypeId)) {
        issues.push({
          issueType: 'PLAN_MISSING_SEAT_TYPE',
          type: 'error',
          category: 'plan',
          id: p.id,
          recordId: p.id,
          recordName: p.name,
          libraryId: p.libraryId || libId,
          branchId: p.branchId,
          sectionId: p.sectionId,
          message: `Plan "${p.name}" (Branch: ${branches.find(b => b.id === p.branchId)?.name || 'All'}) references a missing or unknown seat type.`,
          actionLabel: 'Assign Seat Type',
          actionType: 'EDIT_PLAN_SEAT_TYPE',
          targetTab: 'settings',
          targetSection: 'plans'
        });
      }
    });

    return issues;
  };

  // Add New Student
  const addStudent = (studentData) => {
    if (!hasPermission('students', 'create')) {
      toast.error('Permission Denied: You do not have permission to add students.');
      return false;
    }
    const newStudentId = generateStudentId(studentData.branchId);
    const newReceiptNo = generateReceiptNo();
    const plan = plans.find(p => p.id === studentData.planId);

    const amountPaid = Number(studentData.amountPaid || 0);
    const discount = Number(studentData.discount || 0);
    const fine = Number(studentData.fine || 0);
    const netTotal = amountPaid - discount + fine;

    // Safety validation
    const st = seatTypes.find(t => t.id === studentData.seatTypeId);
    if (st?.allocationMode === 'Fixed') {
      // 1. Validate physical seat actually exists in this branch & section
      const seatObj = seats.find(s => 
        s.name === studentData.seatNo &&
        (!studentData.branchId || !s.branchId || s.branchId === 'all' || s.branchId === studentData.branchId) &&
        (!studentData.sectionId || !s.sectionId || s.sectionId === 'all' || s.sectionId === studentData.sectionId)
      );
      if (!seatObj) {
        alert(`Validation Error: Physical desk "${studentData.seatNo}" does not exist in the configured seat map.`);
        return null;
      }
      // 2. Validate seat is not under maintenance or unavailable
      if (seatObj.isMaintenance || seatObj.isUnavailable) {
        alert(`Seat Conflict: Desk ${studentData.seatNo} is currently ${seatObj.isMaintenance ? 'under maintenance' : 'unavailable'}.`);
        return null;
      }
      // 3. Strict Uniqueness: One physical seat max ONE active student
      const occupant = getSeatOccupancyStatus(settings.libraryId, studentData.branchId, studentData.sectionId, studentData.seatNo, studentData.shiftId);
      if (occupant) {
        alert(`Seat Conflict: Desk ${studentData.seatNo} is already occupied during the requested shift by ${occupant.name}.`);
        return null;
      }
    } else if (st?.allocationMode === 'Non-Fixed' && st.capacityMode === 'Limited') {
      const activeCount = getCurrentActiveAdmissions(settings.libraryId, studentData.branchId, studentData.sectionId, studentData.seatTypeId, studentData.shiftId);
      if (activeCount >= (st.maximumStudentsAllowed || 0)) {
        alert(`Capacity limit reached for ${st.name} (${activeCount}/${st.maximumStudentsAllowed} students).`);
        return null;
      }
    }

    // 4. Strict Plan Compatibility Validation
    if (plan) {
      if (plan.branchId && plan.branchId !== 'all' && studentData.branchId && studentData.branchId !== 'all' && plan.branchId !== studentData.branchId) {
        alert(`Configuration Conflict: Plan "${plan.name}" does not belong to the selected branch.`);
        return null;
      }
      if (plan.sectionId && plan.sectionId !== 'all' && studentData.sectionId && studentData.sectionId !== 'all' && plan.sectionId !== studentData.sectionId) {
        alert(`Configuration Conflict: Plan "${plan.name}" does not belong to the selected section.`);
        return null;
      }
      if (plan.seatTypeId && studentData.seatTypeId && plan.seatTypeId !== studentData.seatTypeId) {
        alert(`Configuration Conflict: Plan "${plan.name}" is not compatible with the selected seat type.`);
        return null;
      }
      if (plan.shiftIds && plan.shiftIds.length > 0 && studentData.shiftId && !plan.shiftIds.includes(studentData.shiftId)) {
        alert(`Configuration Conflict: Plan "${plan.name}" does not support the selected shift.`);
        return null;
      }
    }

    const newRenewal = {
      renewalId: `RN-${Date.now()}`,
      planId: studentData.planId,
      planName: plan?.name || "Standard Plan",
      shiftId: studentData.shiftId,
      shift: studentData.shift,
      durationMonths: studentData.durationMonths || 1,
      startDate: studentData.startDate,
      endDate: studentData.expiryDate,
      amountPaid: netTotal,
      basePrice: amountPaid,
      discount,
      fine,
      receiptNo: newReceiptNo,
      date: todayStr,
      staffName: currentStaff?.name || "Admin"
    };

    const newSeatLog = {
      changeId: `SH-${Date.now()}`,
      previousSeat: "None",
      newSeat: studentData.seatNo || "Non-Fixed Seat",
      reason: "Initial Admission",
      date: todayStr,
      staffName: currentStaff?.name || "Admin"
    };

    const targetBranch = branches.find(b => b.id === studentData.branchId);
    const newPayment = {
      receiptNo: newReceiptNo,
      studentId: newStudentId,
      studentName: studentData.name,
      branchId: studentData.branchId,
      branchName: targetBranch ? targetBranch.name : (settings.name || "Main Branch"),
      branchCode: targetBranch ? targetBranch.code : "BR",
      seatNo: studentData.seatNo || "Non-Fixed Seat",
      seatName: studentData.seatNo || "Non-Fixed Seat",
      planName: plan?.name || "Subscription Plan",
      amount: amountPaid,
      discount,
      fine,
      netTotal,
      method: studentData.paymentMethod || "UPI",
      breakdown: studentData.breakdown,
      date: todayStr,
      staffName: currentStaff?.name || "Admin"
    };

    const newStudentObj = {
      id: newStudentId,
      libraryId: settings.libraryId,
      name: studentData.name,
      phone: studentData.phone,
      emergencyPhone: studentData.emergencyPhone || "",
      branchId: studentData.branchId,
      sectionId: studentData.sectionId,
      blockId: studentData.sectionId,
      seatTypeId: studentData.seatTypeId,
      planId: studentData.planId,
      seatNo: studentData.seatNo || "Non-Fixed Seat",
      shiftId: studentData.shiftId,
      shift: studentData.shift,
      gender: studentData.gender || "Male",
      documents: Array.isArray(studentData.documents) ? studentData.documents : [],
      idProofStatus: studentData.idProofStatus || "Submitted",
      startDate: studentData.startDate,
      expiryDate: studentData.expiryDate,
      status: "Active",
      internalNotes: studentData.internalNotes || "",
      joinedDate: todayStr,
      renewalHistory: [newRenewal],
      seatHistory: [newSeatLog],
      paymentHistory: [newPayment]
    };

    setStudents(prev => [newStudentObj, ...prev]);
    setPayments(prev => [newPayment, ...prev]);

    // Remove from waiting list if present
    if (studentData.waitlistEntryId) {
      removeFromWaitingList(studentData.waitlistEntryId);
    }

    return { student: newStudentObj, receipt: newPayment };
  };

  // Bulk Admission Processor
  const addBulkStudents = (bulkDataArray, fillWaitlist = false) => {
    const accumulatedStudents = [];
    const accumulatedPayments = [];
    const accumulatedWaitlist = [];
    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 0; i < bulkDataArray.length; i++) {
      const studentData = bulkDataArray[i];

      // 1. Transactional Validation
      const check = canAdmitStudent(
        settings.libraryId, 
        studentData.branchId, 
        studentData.sectionId, 
        studentData.seatTypeId, 
        studentData.shiftId, 
        studentData.seatNo !== 'Non-Fixed Seat' ? studentData.seatNo : null,
        accumulatedStudents
      );

      if (!check.allowed) {
        if (fillWaitlist) {
          accumulatedWaitlist.push({
            id: `WL-${Date.now()}-${i}`,
            libraryId: settings.libraryId,
            name: studentData.name,
            phone: studentData.phone,
            branchId: studentData.branchId,
            sectionId: studentData.sectionId,
            seatTypeId: studentData.seatTypeId,
            shiftId: studentData.shiftId,
            planId: studentData.planId,
            notes: "Added from Bulk Admission overflow",
            date: todayStr,
            status: "Pending"
          });
        }
        continue;
      }

      // 2. ID Generation
      const newStudentId = generateStudentId(studentData.branchId, accumulatedStudents);
      const newReceiptNo = generateReceiptNo(accumulatedPayments);

      const plan = plans.find(p => p.id === studentData.planId);
      const shiftObj = shifts.find(s => s.id === studentData.shiftId);
      const shiftName = shiftObj ? shiftObj.name : 'Full Day';

      const newRenewal = {
        renewalId: `RN-${Date.now()}-${i}`,
        planId: studentData.planId,
        planName: plan?.name || "Standard Plan",
        shiftId: studentData.shiftId,
        shift: shiftName,
        durationMonths: studentData.durationMonths || 1,
        startDate: studentData.startDate,
        endDate: studentData.expiryDate,
        amountPaid: studentData.netTotal,
        basePrice: studentData.baseAmount,
        discount: studentData.calculatedDiscount,
        fine: studentData.fine,
        receiptNo: newReceiptNo,
        date: todayStr,
        staffName: currentStaff?.name || "Admin"
      };

      const newSeatLog = {
        changeId: `SH-${Date.now()}-${i}`,
        previousSeat: "None",
        newSeat: studentData.seatNo || "Non-Fixed Seat",
        reason: "Bulk Admission",
        date: todayStr,
        staffName: currentStaff?.name || "Admin"
      };

      const newPayment = {
        receiptNo: newReceiptNo,
        studentId: newStudentId,
        studentName: studentData.name,
        branchId: studentData.branchId,
        seatNo: studentData.seatNo || "Non-Fixed Seat",
        planName: plan?.name || "Subscription Plan",
        amount: studentData.baseAmount,
        discount: studentData.calculatedDiscount,
        fine: studentData.fine,
        netTotal: studentData.netTotal,
        method: studentData.paymentMethod || "Cash",
        breakdown: studentData.breakdown,
        date: todayStr,
        staffName: currentStaff?.name || "Admin"
      };

      const newStudentObj = {
        id: newStudentId,
        libraryId: settings.libraryId,
        name: studentData.name,
        phone: studentData.phone,
        emergencyPhone: studentData.emergencyPhone || "",
        branchId: studentData.branchId,
        sectionId: studentData.sectionId,
        blockId: studentData.sectionId,
        seatTypeId: studentData.seatTypeId,
        planId: studentData.planId,
        seatNo: studentData.seatNo || "Non-Fixed Seat",
        shiftId: studentData.shiftId,
        shift: shiftName,
        gender: studentData.gender || "Male",
        documents: [],
        idProofStatus: "Submitted",
        startDate: studentData.startDate,
        expiryDate: studentData.expiryDate,
        status: "Active",
        internalNotes: "Bulk Admitted",
        joinedDate: todayStr,
        renewalHistory: [newRenewal],
        seatHistory: [newSeatLog],
        paymentHistory: [newPayment]
      };

      accumulatedStudents.push(newStudentObj);
      accumulatedPayments.push(newPayment);
    }

    // 3. Safe Commit
    if (accumulatedStudents.length > 0) {
      setStudents(prev => [...accumulatedStudents, ...prev]);
      setPayments(prev => [...accumulatedPayments, ...prev]);
    }
    if (accumulatedWaitlist.length > 0) {
      setWaitingList(prev => [...accumulatedWaitlist, ...prev]);
    }

    return {
      successCount: accumulatedStudents.length,
      waitlistCount: accumulatedWaitlist.length
    };
  };

  // Renew Subscription
  const renewSubscription = (studentId, renewalData) => {
    if (!hasPermission('renewals', 'create') && !hasPermission('students', 'edit')) {
      toast.error('Permission Denied: You do not have permission to process renewals.');
      return false;
    }
    const student = students.find(s => s.id === studentId);
    if (!student) return { error: 'NOT_FOUND', message: 'Student not found.' };

    const newReceiptNo = generateReceiptNo();
    const amountPaid = Number(renewalData.amountPaid || 0);
    const discount = Number(renewalData.discount || 0);
    const fine = Number(renewalData.fine || 0);
    const netTotal = amountPaid - discount + fine;

    const newRenewal = {
      renewalId: `RN-${Date.now()}`,
      planId: renewalData.planId || student.planId,
      planName: renewalData.planName,
      shiftId: renewalData.shiftId || student.shiftId,
      shift: renewalData.shift || student.shift,
      durationMonths: renewalData.durationMonths || 1,
      startDate: renewalData.startDate,
      endDate: renewalData.expiryDate,
      amountPaid: netTotal,
      basePrice: amountPaid,
      discount,
      fine,
      receiptNo: newReceiptNo,
      date: todayStr,
      staffName: currentStaff?.name || "Admin",
      seatNo: student.seatNo
    };

    const targetBranch = branches.find(b => b.id === student.branchId);
    const newPayment = {
      receiptNo: newReceiptNo,
      studentId: student.id,
      studentName: student.name,
      branchId: student.branchId,
      branchName: targetBranch ? targetBranch.name : (settings.name || "Main Branch"),
      branchCode: targetBranch ? targetBranch.code : "BR",
      seatNo: student.seatNo || "Non-Fixed Seat",
      seatName: student.seatNo || "Non-Fixed Seat",
      planName: renewalData.planName,
      amount: amountPaid,
      discount,
      fine,
      netTotal,
      method: renewalData.paymentMethod || "UPI",
      breakdown: renewalData.breakdown,
      date: todayStr,
      staffName: currentStaff?.name || "Admin"
    };

    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        return {
          ...s,
          planId: renewalData.planId || s.planId,
          shiftId: renewalData.shiftId || s.shiftId,
          shift: renewalData.shift || s.shift,
          startDate: renewalData.startDate,
          expiryDate: renewalData.expiryDate,
          status: "Active",
          renewalHistory: [newRenewal, ...s.renewalHistory],
          paymentHistory: [newPayment, ...s.paymentHistory]
        };
      }
      return s;
    }));

    setPayments(prev => [newPayment, ...prev]);
    return newPayment;
  };

  const addStudentDocument = (studentId, docObj) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      const existing = Array.isArray(s.documents) ? s.documents : [];
      return {
        ...s,
        documents: [...existing, docObj],
        idProofStatus: "Verified"
      };
    }));
    return true;
  };

  const extendStudentDueDate = (studentId, newDueDate, reason = "Due Date Extension") => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      const newExtension = {
        id: `EXT-${Date.now()}`,
        grantedAt: todayStr,
        staffName: currentStaff?.name || "Admin",
        originalDueDate: s.expiryDate,
        individualExtensionEndDate: newDueDate,
        reason: reason
      };

      return {
        ...s,
        extendedDueDate: newDueDate,
        extensionReason: reason,
        extensionHistory: [newExtension, ...(s.extensionHistory || [])]
      };
    }));
    return true;
  };

  // Change Student Seat (Full Scope & Shift-Overlap Relocation)
  const changeSeat = (studentId, newSectionId, newSeatTypeId, newSeatNo, reason, newShiftId, newBranchId) => {
    if (!hasPermission('students', 'edit')) {
      toast.error('Permission Denied: You do not have permission to change seats.');
      return false;
    }
    const student = students.find(s => s.id === studentId);
    if (!student) return false;

    const previousBranchId = student.branchId;
    const previousSectionId = student.sectionId;
    const previousSeatTypeId = student.seatTypeId;
    const previousShiftId = student.shiftId;
    const previousSeatNo = student.seatNo;

    const branchId = newBranchId || student.branchId;
    const sectionId = newSectionId || student.sectionId;
    const seatTypeId = newSeatTypeId || student.seatTypeId;
    const shiftId = newShiftId || student.shiftId;
    const reqShiftObj = shifts.find(sh => sh.id === shiftId);

    const prevBranchObj = branches.find(b => b.id === previousBranchId) || branches[0];
    const newBranchObj = branches.find(b => b.id === branchId) || branches[0];

    if (newSeatNo !== 'Non-Fixed Seat' && newSeatNo !== 'None' && newSeatNo !== 'Non-Fixed / Not Assigned') {
      // 1. Validate physical seat actually exists
      const seatObj = seats.find(s => 
        s.name === newSeatNo &&
        (!branchId || !s.branchId || s.branchId === 'all' || s.branchId === branchId) &&
        (!sectionId || !s.sectionId || s.sectionId === 'all' || s.sectionId === sectionId)
      );
      if (!seatObj) {
        toast.error(`Validation Error: Physical desk "${newSeatNo}" does not exist in this section.`);
        return false;
      }
      // 2. Validate seat is not under maintenance or unavailable
      if (seatObj.isMaintenance || seatObj.isUnavailable) {
        toast.error(`Seat Conflict: Desk ${newSeatNo} is currently ${seatObj.isMaintenance ? 'under maintenance' : 'unavailable'}.`);
        return false;
      }
      // 3. Strict Uniqueness & Shift Overlap: Desk cannot be used by overlapping shifts
      const occupant = getSeatOccupancyStatus(settings.libraryId, branchId, sectionId, newSeatNo, shiftId, [], studentId);
      if (occupant) {
        toast.error(`Seat Conflict: Desk ${newSeatNo} is already occupied during this shift by ${occupant.name}.`);
        return false;
      }
    }

    const newSeatLog = {
      changeId: `SH-${Date.now()}`,
      previousBranchId,
      previousBranchName: prevBranchObj?.name || "Main Branch",
      previousSectionId,
      previousSeatTypeId,
      previousShiftId,
      previousSeat: previousSeatNo,
      previousSeatId: previousSeatNo,
      newBranchId: branchId,
      newBranchName: newBranchObj?.name || "Main Branch",
      newSectionId: sectionId,
      newSeatTypeId: seatTypeId,
      newShiftId: shiftId,
      newSeat: newSeatNo,
      newSeatId: newSeatNo,
      previousShift: student.shift,
      newShift: reqShiftObj ? reqShiftObj.name : student.shift,
      reason: reason || "Relocation",
      date: todayStr,
      staffName: currentStaff?.name || "Admin"
    };

    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        return {
          ...s,
          branchId,
          sectionId,
          blockId: sectionId,
          seatTypeId,
          seatNo: newSeatNo,
          shiftId,
          shift: reqShiftObj ? reqShiftObj.name : s.shift,
          seatHistory: [newSeatLog, ...(s.seatHistory || [])]
        };
      }
      return s;
    }));
    return true;
  };

  // Add Expense
  const addExpense = (expenseData) => {
    const newExpense = {
      id: `EXP-${Date.now()}`,
      branchId: expenseData.branchId,
      category: expenseData.category,
      amount: Number(expenseData.amount),
      date: expenseData.date || todayStr,
      mode: expenseData.mode || "Cash",
      notes: expenseData.notes || ""
    };
    setExpenses(prev => [newExpense, ...prev]);
  };

  // Shift Management
  const addShift = (shiftData) => {
    const newShift = {
      id: `sh-${Date.now()}`,
      name: shiftData.name,
      startTime: shiftData.startTime || "06:00",
      endTime: shiftData.endTime || "12:00",
      daysOfWeek: shiftData.daysOfWeek || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      branchId: shiftData.branchId || 'all',
      libraryId: settings.libraryId,
      active: true
    };
    setShifts(prev => [...prev, newShift]);
    return newShift;
  };

  const updateShift = (shiftId, shiftData) => {
    setShifts(prev => prev.map(s => s.id === shiftId ? {
      ...s,
      name: shiftData.name,
      startTime: shiftData.startTime || s.startTime,
      endTime: shiftData.endTime || s.endTime,
      daysOfWeek: shiftData.daysOfWeek || s.daysOfWeek,
      active: shiftData.active !== undefined ? shiftData.active : s.active
    } : s));
  };

  const deleteShift = (shiftId) => {
    const check = canDeleteShift(shiftId);
    if (!check.allowed) {
      alert(check.reason);
      return false;
    }
    setShifts(prev => prev.filter(s => s.id !== shiftId));
    return true;
  };

  // Archive & Cancellation
  const archiveStudent = (studentId, cancelReason, refundAmount = 0) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    
    const cancellationRecord = {
      id: `CANC-${Date.now()}`,
      reason: cancelReason || "Cancelled",
      refundAmount,
      date: todayStr,
      staffName: currentStaff?.name || "Admin"
    };
    
    const updatedStudent = { 
      ...student, 
      cancellationHistory: [cancellationRecord, ...(student.cancellationHistory || [])]
    };
    
    setArchivedStudents(prev => [updatedStudent, ...prev]);
    setStudents(prev => prev.filter(s => s.id !== studentId));
  };

  const restoreStudent = (studentId, newSeatNo) => {
    const student = archivedStudents.find(s => s.id === studentId);
    if (!student) return;

    const restoredStudent = { ...student };
    if (newSeatNo) {
      restoredStudent.seatNo = newSeatNo;
      restoredStudent.seatHistory = [
        { changeId: `SH-${Date.now()}`, previousSeat: student.seatNo, newSeat: newSeatNo, reason: "Restored from Archive", date: todayStr, staffName: currentStaff?.name || "Admin" },
        ...student.seatHistory
      ];
    }

    setStudents(prev => [restoredStudent, ...prev]);
    setArchivedStudents(prev => prev.filter(s => s.id !== studentId));
  };

  const permanentlyDeleteStudent = (studentId) => {
    setArchivedStudents(prev => prev.filter(s => s.id !== studentId));
  };

  const clearArchivedHistory = () => {
    setArchivedStudents([]);
  };

  // Central Staff & Action Authorization Checker
  const hasPermission = (moduleName, actionName = 'view', staff = currentStaff) => {
    if (!staff) return false;
    // Inactive staff members cannot perform any actions
    if (staff.status === 'Inactive') return false;
    // Admins have full access
    if (staff.role === 'Admin') return true;

    const mod = staff.permissions?.[moduleName];
    if (mod) {
      if (mod.manage) return true;
      if (typeof mod[actionName] === 'boolean') return mod[actionName];
    }

    // Fallbacks for legacy boolean flags only if mod is missing
    if (!mod) {
      if (moduleName === 'students' && actionName === 'edit') return Boolean(staff.permissions?.canManageStudents);
      if (moduleName === 'students' && actionName === 'view') return true;
      if (moduleName === 'payments' && actionName === 'create') return Boolean(staff.permissions?.canProcessPayments);
      if (moduleName === 'seats' && actionName === 'edit') return Boolean(staff.permissions?.canEditSeats);
      if (moduleName === 'expenses' && actionName === 'create') return Boolean(staff.permissions?.canManageExpenses);
      if (moduleName === 'reports' && actionName === 'view') return Boolean(staff.permissions?.canViewFinancials);
      if (moduleName === 'settings' && actionName === 'edit') return Boolean(staff.permissions?.canManageSettings);
      if (moduleName === 'admissions' && actionName === 'delete') return Boolean(staff.permissions?.canCancelAdmission);
      if (moduleName === 'payments' && actionName === 'approve') return Boolean(staff.permissions?.canProcessRefunds);
    }

    return false;
  };

  const cancelAdmission = (studentId, reason, refundAmount = 0) => {
    if (!hasPermission('admissions', 'delete')) {
      toast.error('Permission denied: You do not have permission to cancel admissions.');
      return false;
    }
    if (refundAmount > 0 && !hasPermission('payments', 'approve') && !hasPermission('payments', 'delete')) {
      toast.error('Permission denied: You do not have permission to process refunds.');
      return false;
    }

    const student = students.find(s => s.id === studentId);
    if (!student) return false;

    if (refundAmount > 0) {
      const newPayment = {
        receiptNo: `REF-${Date.now()}`,
        studentId: student.id,
        studentName: student.name,
        branchId: student.branchId,
        planName: "Admission Cancellation Refund",
        amount: -Math.abs(refundAmount),
        discount: 0,
        fine: 0,
        netTotal: -Math.abs(refundAmount),
        method: "Refund",
        date: todayStr,
        staffName: currentStaff?.name || "Admin"
      };
      setPayments(prev => [newPayment, ...prev]);
    }

    archiveStudent(studentId, reason, refundAmount);
    return true;
  };

  const cancelRenewalTransaction = (studentId, renewalId) => {
    if (!hasPermission('renewals', 'delete')) {
      toast.error('Permission denied: You do not have permission to cancel renewal transactions.');
      return false;
    }

    const student = students.find(s => s.id === studentId);
    if (!student) return false;

    const renewalIndex = student.renewalHistory?.findIndex(r => r.renewalId === renewalId);
    if (renewalIndex === -1 || renewalIndex === undefined) return false;

    const renewalToCancel = student.renewalHistory[renewalIndex];
    const newRenewalHistory = student.renewalHistory.filter(r => r.renewalId !== renewalId);
    const newPaymentHistory = student.paymentHistory.filter(p => p.receiptNo !== renewalToCancel.receiptNo);

    let updates = {
      renewalHistory: newRenewalHistory,
      paymentHistory: newPaymentHistory
    };

    if (renewalIndex === 0) {
      let newStartDate, newExpiryDate, newPlanId, newPlanName, newShift, newSeatNo;
      if (newRenewalHistory.length > 0) {
        newStartDate = newRenewalHistory[0].startDate;
        newExpiryDate = newRenewalHistory[0].endDate;
        newPlanId = newRenewalHistory[0].planId || student.planId;
        newPlanName = newRenewalHistory[0].planName;
        newShift = newRenewalHistory[0].shift || student.shift;
        newSeatNo = newRenewalHistory[0].seatNo || student.seatNo;
      } else {
        newStartDate = student.joinedDate;
        newExpiryDate = student.expiryDate;
        newPlanId = student.planId;
        newPlanName = student.planName;
        newShift = student.shift;
        newSeatNo = student.seatNo;
      }
      updates = {
        ...updates,
        startDate: newStartDate,
        expiryDate: newExpiryDate,
        planId: newPlanId,
        planName: newPlanName,
        shift: newShift,
        seatNo: newSeatNo
      };
    }

    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updates } : s));
    setPayments(prev => prev.filter(p => p.receiptNo !== renewalToCancel.receiptNo));
    return true;
  };

  const updateStudentDetails = (studentId, details) => {
    if (!hasPermission('students', 'edit')) {
      toast.error('Permission Denied: You do not have permission to update student details.');
      return false;
    }
    const student = students.find(s => s.id === studentId);
    if (!student) return { error: true, message: 'Student not found.' };

    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        return { ...s, ...details };
      }
      return s;
    }));

    return { error: false, student: { ...student, ...details } };
  };

  // Add Staff Member
  const addStaffMember = (staffData) => {
    if (!hasPermission('staff', 'create')) {
      toast.error('Permission denied: You cannot add new staff members.');
      return null;
    }

    if (!staffData.name || !staffData.name.trim()) {
      toast.error('Staff name is required.');
      return null;
    }
    if (!staffData.phone || !staffData.phone.trim()) {
      toast.error('Staff contact number is required.');
      return null;
    }

    const assignedRole = staffData.role || 'Librarian';
    const basePermissions = staffData.permissions || getDefaultPermissionsForRole(assignedRole);
    const syncedPermissions = syncLegacyPermissions(basePermissions);

    const newStaff = {
      id: `st-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name: staffData.name.trim(),
      phone: staffData.phone.trim(),
      email: (staffData.email || '').trim(),
      role: assignedRole,
      status: staffData.status || 'Active',
      branchId: staffData.branchId || 'all',
      libraryId: settings.libraryId || 'lib-main',
      createdAt: todayStr,
      notes: staffData.notes || '',
      permissions: syncedPermissions
    };

    setStaffMembers(prev => [...prev, newStaff]);
    toast.success(`Staff member "${newStaff.name}" added successfully.`);
    return newStaff;
  };

  // Update Staff Member Details, Role & Permissions
  const updateStaffMember = (staffId, updatedData) => {
    if (!hasPermission('staff', 'edit')) {
      toast.error('Permission denied: You cannot edit staff members.');
      return false;
    }

    let updatedMember = null;
    setStaffMembers(prev => prev.map(st => {
      if (st.id === staffId) {
        const role = updatedData.role !== undefined ? updatedData.role : st.role;
        let perms = updatedData.permissions !== undefined ? updatedData.permissions : st.permissions;
        if (updatedData.role && updatedData.role !== st.role && !updatedData.permissions) {
          perms = getDefaultPermissionsForRole(updatedData.role);
        }
        perms = syncLegacyPermissions(perms);

        updatedMember = {
          ...st,
          ...updatedData,
          role,
          permissions: perms
        };
        return updatedMember;
      }
      return st;
    }));

    if (updatedMember) {
      toast.success(`Staff member "${updatedMember.name}" updated successfully.`);
      return true;
    }
    return false;
  };

  // Toggle Staff Active / Inactive Status
  const toggleStaffStatus = (staffId) => {
    if (!hasPermission('staff', 'edit')) {
      toast.error('Permission denied: You cannot modify staff status.');
      return false;
    }

    const target = staffMembers.find(st => st.id === staffId);
    if (!target) return false;

    // Safety: Cannot deactivate the last active Admin
    if (target.role === 'Admin' && target.status === 'Active') {
      const activeAdmins = staffMembers.filter(st => st.role === 'Admin' && st.status === 'Active');
      if (activeAdmins.length <= 1) {
        toast.error('Cannot deactivate the last active Admin.');
        return false;
      }
    }

    const newStatus = target.status === 'Active' ? 'Inactive' : 'Active';
    setStaffMembers(prev => prev.map(st => st.id === staffId ? { ...st, status: newStatus } : st));
    toast.success(`Staff member "${target.name}" marked as ${newStatus}.`);
    return true;
  };

  // Delete Staff Member
  const deleteStaffMember = (staffId) => {
    if (!hasPermission('staff', 'delete')) {
      toast.error('Permission denied: You cannot delete staff members.');
      return false;
    }

    const target = staffMembers.find(st => st.id === staffId);
    if (!target) return false;

    // Safety: Prevent deleting the last Admin
    if (target.role === 'Admin') {
      const admins = staffMembers.filter(st => st.role === 'Admin');
      if (admins.length <= 1) {
        toast.error('Cannot delete the last remaining Admin.');
        return false;
      }
    }

    // Safety: Prevent deleting currently selected active staff member
    if (currentStaff && currentStaff.id === staffId) {
      toast.error('Cannot delete the staff member you are currently operating as. Switch staff first.');
      return false;
    }

    setStaffMembers(prev => prev.filter(st => st.id !== staffId));
    toast.success(`Staff member "${target.name}" removed.`);
    return true;
  };

  // Export / Import
  const exportDataJSON = () => {
    const data = {
      settings,
      branches,
      sections,
      seatTypes,
      seats,
      plans,
      shifts,
      staffMembers,
      students,
      archivedStudents,
      expenses,
      payments,
      waitingList,
      exportDate: new Date().toISOString()
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', `library_backup_${todayStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const importDataJSON = (jsonData) => {
    try {
      if (jsonData.settings) setSettings(jsonData.settings);
      if (jsonData.branches) setBranches(jsonData.branches);
      if (jsonData.sections) setSections(jsonData.sections);
      if (jsonData.seatTypes) setSeatTypes(jsonData.seatTypes);
      if (jsonData.seats) setSeats(jsonData.seats);
      if (jsonData.plans) setPlans(jsonData.plans);
      if (jsonData.shifts) setShifts(jsonData.shifts);
      if (jsonData.staffMembers) setStaffMembers(jsonData.staffMembers);
      if (jsonData.students) setStudents(jsonData.students);
      if (jsonData.archivedStudents) setArchivedStudents(jsonData.archivedStudents);
      if (jsonData.expenses) setExpenses(jsonData.expenses);
      if (jsonData.payments) setPayments(jsonData.payments);
      if (jsonData.waitingList) setWaitingList(jsonData.waitingList);
      return true;
    } catch (e) {
      console.error("Failed to import JSON data", e);
      return false;
    }
  };

  const getSetupStatus = () => {
    if (settings.isSetupComplete || settings.setupStatus === 'COMPLETED') return 'COMPLETED';
    const draft = localStorage.getItem('wizardDraft');
    return draft ? 'DRAFT' : 'NOT_STARTED';
  };

  // 🧪 Random Test Student Generator (Development / Testing Tool)
  const generateTestStudents = (requestedCount = 25, options = { branchScope: 'all' }) => {
    const activePlans = plans.filter(p => p.active !== false && p.shiftIds && p.shiftIds.length > 0 && p.seatTypeId);
    const activeShifts = shifts.filter(sh => sh.active !== false);

    if (activePlans.length === 0 || activeShifts.length === 0 || seatTypes.length === 0) {
      return {
        requested: requestedCount,
        created: 0,
        skipped: requestedCount,
        reasons: ["No active fee plans, shifts, or seat types configured. Complete Setup Wizard or configure in Settings first."]
      };
    }

    const firstNames = [
      "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
      "Saanvi", "Aanya", "Aadhya", "Ananya", "Pari", "Diya", "Navya", "Riya", "Myra", "Avani",
      "Rohan", "Priya", "Ankit", "Sneha", "Kunal", "Pooja", "Vikram", "Neha", "Rahul", "Tanvi"
    ];
    const lastNames = [
      "Sharma", "Verma", "Patel", "Mehta", "Singh", "Kumar", "Gupta", "Joshi", "Chopra", "Deshmukh",
      "Reddy", "Nair", "Iyer", "Rao", "Bose", "Ghosh", "Kulkarni", "Trivedi", "Mishra", "Pandey"
    ];

    let createdCount = 0;
    const skippedReasons = [];
    const newStudents = [];
    const newPayments = [];

    // Track simulated seat allocations and non-fixed capacity counts during this batch
    const batchSeatAllocations = [];
    const batchNonFixedCounts = {};

    for (let i = 0; i < requestedCount; i++) {
      // Pick a plan round-robin from activePlans
      const plan = activePlans[i % activePlans.length];
      const planShifts = activeShifts.filter(sh => plan.shiftIds.includes(sh.id));
      if (planShifts.length === 0) {
        skippedReasons.push(`Plan "${plan.name}" has no valid operating shift.`);
        continue;
      }

      // Pick a shift from the plan's shifts
      const shiftObj = planShifts[i % planShifts.length];
      
      let targetBranchId = plan.branchId && plan.branchId !== 'all' ? plan.branchId : 'all';
      if (options.branchScope === 'current' && activeBranchId && activeBranchId !== 'all') {
        if (plan.branchId && plan.branchId !== 'all' && plan.branchId !== activeBranchId) {
          skippedReasons.push(`Plan "${plan.name}" does not belong to active branch.`);
          continue;
        }
        targetBranchId = activeBranchId;
      } else if (targetBranchId === 'all') {
        const eligibleBranches = branches.filter(b => settings.libraryId === 'all' || b.libraryId === settings.libraryId);
        targetBranchId = eligibleBranches.length > 0 ? eligibleBranches[i % eligibleBranches.length].id : 'all';
      }

      const targetSectionId = plan.sectionId && plan.sectionId !== 'all' ? plan.sectionId : (sections[0]?.id || undefined);
      const st = seatTypes.find(t => t.id === plan.seatTypeId);

      if (!st) {
        skippedReasons.push(`Plan "${plan.name}" references an unknown seat type.`);
        continue;
      }

      let assignedSeatNo = 'Non-Fixed Seat';

      if (st.allocationMode === 'Fixed') {
        // Find available eligible physical seat
        const eligibleDesks = seats.filter(s => {
          if (settings.libraryId && s.libraryId && s.libraryId !== settings.libraryId) return false;
          if (targetBranchId !== 'all' && s.branchId && s.branchId !== 'all' && s.branchId !== targetBranchId) return false;
          if (targetSectionId && s.sectionId && s.sectionId !== targetSectionId) return false;
          if (s.seatTypeId !== st.id) return false;
          if (s.isMaintenance || s.isUnavailable) return false;

          // Check if occupied by existing live students
          const occupant = getSeatOccupancyStatus(settings.libraryId, targetBranchId, targetSectionId, s.name, shiftObj.id);
          if (occupant) return false;

          // Check if occupied by a batch-allocated student on an overlapping shift
          const batchOccupied = batchSeatAllocations.some(b => 
            b.seatName === s.name &&
            (!b.branchId || !targetBranchId || b.branchId === targetBranchId || b.branchId === 'all' || targetBranchId === 'all') &&
            (!b.sectionId || !targetSectionId || b.sectionId === targetSectionId) &&
            shiftsOverlap(b.shiftObj, shiftObj)
          );
          return !batchOccupied;
        });

        if (eligibleDesks.length === 0) {
          skippedReasons.push(`No physical desk available in "${st.name}" for shift "${shiftObj.name}".`);
          continue;
        }

        const chosenDesk = eligibleDesks[0];
        assignedSeatNo = chosenDesk.name;
        batchSeatAllocations.push({
          seatName: chosenDesk.name,
          branchId: chosenDesk.branchId || targetBranchId,
          sectionId: chosenDesk.sectionId || targetSectionId,
          shiftObj
        });
      } else {
        // Non-Fixed allocation
        if (st.capacityMode === 'Limited') {
          const max = st.maximumStudentsAllowed || 0;
          const currentCount = getCurrentActiveAdmissions(settings.libraryId, targetBranchId, targetSectionId, st.id, shiftObj.id);
          const batchCount = batchNonFixedCounts[`${st.id}_${shiftObj.id}`] || 0;
          if (currentCount + batchCount >= max) {
            skippedReasons.push(`Limited capacity full (${max} students) for Non-Fixed "${st.name}" on shift "${shiftObj.name}".`);
            continue;
          }
          batchNonFixedCounts[`${st.id}_${shiftObj.id}`] = batchCount + 1;
        }
      }

      // Duration & Pricing
      const pricingTiers = plan.durationPricing && plan.durationPricing.length > 0 
        ? plan.durationPricing 
        : [{ durationMonths: 1, basePrice: 1500, discountType: 'None', discountValue: 0 }];
      const chosenTier = pricingTiers[i % pricingTiers.length];

      const durationMonths = chosenTier.durationMonths || 1;
      const basePrice = Number(chosenTier.basePrice || 1500);
      let discount = 0;
      if (chosenTier.discountType === 'Percentage') {
        discount = Math.round((basePrice * (chosenTier.discountValue || 0)) / 100);
      } else if (chosenTier.discountType === 'Fixed') {
        discount = Math.min(basePrice, Number(chosenTier.discountValue || 0));
      }
      const netTotal = Math.max(0, basePrice - discount);

      // Realistic status variety: 70% Active, 15% Expiring Soon, 15% Expired
      let status = 'Active';
      let startDateStr = todayStr;
      let expiryDateStr = '';
      const scenarioSeed = i % 10;
      const now = new Date();

      if (scenarioSeed === 8) {
        status = 'Expiring Soon';
        const expDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        expiryDateStr = expDate.toISOString().split('T')[0];
        const stDate = new Date(expDate.getTime() - durationMonths * 30 * 24 * 60 * 60 * 1000);
        startDateStr = stDate.toISOString().split('T')[0];
      } else if (scenarioSeed === 9) {
        status = 'Expired';
        const expDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        expiryDateStr = expDate.toISOString().split('T')[0];
        const stDate = new Date(expDate.getTime() - durationMonths * 30 * 24 * 60 * 60 * 1000);
        startDateStr = stDate.toISOString().split('T')[0];
      } else {
        status = 'Active';
        const expDate = new Date(now.getTime() + (durationMonths * 30 - 5) * 24 * 60 * 60 * 1000);
        expiryDateStr = expDate.toISOString().split('T')[0];
        startDateStr = todayStr;
      }

      const fName = firstNames[(i + createdCount) % firstNames.length];
      const lName = lastNames[(i * 3 + createdCount) % lastNames.length];
      const studentName = `TEST ${fName} ${lName}`;
      const uniqueNum = 1000 + students.length + createdCount + 1;
      const studentId = `TEST-STU-${uniqueNum}`;
      const receiptNo = `TEST-REC-${Date.now()}-${createdCount + 1}`;
      const gender = i % 2 === 0 ? 'Male' : 'Female';
      const phone = `98765${String(10000 + (uniqueNum % 90000)).slice(-5)}`;

      const newRenewal = {
        renewalId: `TEST-RN-${Date.now()}-${createdCount + 1}`,
        planId: plan.id,
        planName: plan.name,
        shiftId: shiftObj.id,
        shift: shiftObj.name,
        durationMonths,
        startDate: startDateStr,
        endDate: expiryDateStr,
        amountPaid: netTotal,
        basePrice,
        discount,
        fine: 0,
        receiptNo,
        date: startDateStr,
        staffName: currentStaff?.name || "Admin (Test Generator)"
      };

      const newStudentObj = {
        id: studentId,
        libraryId: settings.libraryId,
        name: studentName,
        phone,
        emergencyPhone: `91234${String(10000 + (uniqueNum % 90000)).slice(-5)}`,
        branchId: targetBranchId,
        sectionId: targetSectionId,
        blockId: targetSectionId,
        seatTypeId: st.id,
        planId: plan.id,
        seatNo: assignedSeatNo,
        shiftId: shiftObj.id,
        shift: shiftObj.name,
        gender,
        documents: ["Aadhaar Card"],
        idProofStatus: "Submitted",
        startDate: startDateStr,
        expiryDate: expiryDateStr,
        status,
        internalNotes: "Synthetic student created via Test Data Generator.",
        joinedDate: startDateStr,
        renewalHistory: [newRenewal],
        seatHistory: [{
          changeId: `TEST-SH-${Date.now()}-${createdCount + 1}`,
          previousSeat: "None",
          newSeat: assignedSeatNo,
          reason: "Synthetic Admission",
          date: startDateStr,
          staffName: currentStaff?.name || "Admin"
        }],
        isTestData: true,
        source: 'TEST_GENERATOR'
      };

      const newPayment = {
        receiptNo,
        studentId,
        studentName,
        branchId: targetBranchId,
        planName: plan.name,
        amount: basePrice,
        discount,
        fine: 0,
        netTotal,
        method: i % 3 === 0 ? "Cash" : "UPI",
        date: startDateStr,
        staffName: currentStaff?.name || "Admin (Test Generator)",
        isTestData: true,
        source: 'TEST_GENERATOR'
      };

      newStudents.push(newStudentObj);
      newPayments.push(newPayment);
      createdCount++;
    }

    if (newStudents.length > 0) {
      setStudents(prev => [...prev, ...newStudents]);
      setPayments(prev => [...prev, ...newPayments]);
    }

    return {
      requested: requestedCount,
      created: createdCount,
      skipped: requestedCount - createdCount,
      reasons: [...new Set(skippedReasons)]
    };
  };

  // Safe cleanup for synthetic test records only
  const clearTestData = () => {
    let removedCount = 0;
    setStudents(prev => {
      const filtered = prev.filter(s => !(s.isTestData === true || s.source === 'TEST_GENERATOR'));
      removedCount = prev.length - filtered.length;
      return filtered;
    });
    setPayments(prev => prev.filter(p => !(p.isTestData === true || p.source === 'TEST_GENERATOR')));
    setWaitingList(prev => prev.filter(w => !(w.isTestData === true || w.source === 'TEST_GENERATOR')));
    return { count: removedCount };
  };

  const resetToDemoData = () => {
    setSettings(INITIAL_SETTINGS);
    setBranches(INITIAL_BRANCHES);
    setSections(INITIAL_SECTIONS);
    setSeatTypes(INITIAL_SEAT_TYPES);
    setSeats(INITIAL_SEATS);
    setPlans(INITIAL_PLANS);
    setShifts(INITIAL_SHIFTS);
    setStaffMembers(INITIAL_STAFF);
    setStudents(INITIAL_STUDENTS);
    setExpenses(INITIAL_EXPENSES);
    setPayments(INITIAL_PAYMENTS);
    setArchivedStudents(INITIAL_ARCHIVED_STUDENTS);
    setWaitingList(INITIAL_WAITING_LIST);
    localStorage.clear();
  };

  localStorage.setItem('DEBUG_DID_RENDER', 'YES_RENDERED_WITH_' + seatTypes.length);

  return (
    <LibraryContext.Provider value={{
      settings, setSettings,
      branches, setBranches,
      sections, setSections,
      seatTypes, setSeatTypes,
      seats, setSeats,
      shifts, setShifts,
      plans, setPlans,
      activeBranchId, setActiveBranchId,
      staffMembers, setStaffMembers,
      currentStaff, setCurrentStaff,
      students, setStudents,
      expenses, setExpenses,
      payments, setPayments,
      archivedStudents, setArchivedStudents,
      waitingList, setWaitingList,
      todayStr,
      // Central helpers
      getSetupStatus,
      resolveScope,
      getEligibleSeatTypes,
      getSeatOccupancyStatus,
      getBlockOccupancyMap,
      getCurrentActiveAdmissions,
      getAvailableEligibleSeats,
      getValidDesksList,
      canAdmitStudent,
      getMatchingPlans,
      getValidShiftsForPlan,
      getUnsyncedShifts,
      getUnsyncedPlans,
      checkDataIntegrity,
      // Test data generator & cleanup
      generateTestStudents,
      clearTestData,
      // Deletion checks
      canDeleteShift,
      canDeletePlan,
      canDeleteSeat,
      canDeleteSection,
      canDeleteSeatType,
      // Branch copying
      copyFromBranch,
      // Actions
      addStudent,
      updateStudentDetails,
      addBulkStudents,
      renewSubscription,
      changeSeat,
      addStudentDocument,
      extendStudentDueDate,
      addToWaitingList,
      getEligibleWaitingStudents,
      removeFromWaitingList,
      updateWaitingListStatus,
      addExpense,
      addShift,
      updateShift,
      deleteShift,
      archiveStudent,
      cancelAdmission,
      cancelRenewalTransaction,
      restoreStudent,
      permanentlyDeleteStudent,
      clearArchivedHistory,
      exportDataJSON,
      importDataJSON,
      resetToDemoData,
      // Staff & Permissions
      hasPermission,
      addStaffMember,
      updateStaffMember,
      toggleStaffStatus,
      deleteStaffMember
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = () => useContext(LibraryContext);
