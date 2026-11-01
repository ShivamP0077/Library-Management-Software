// Shift Overlap and Scheduling Utilities

export const normalizeShiftName = (name) => {
  return String(name || '').trim().toLowerCase();
};

export const resolveCanonicalShift = (shifts = [], shiftRef) => {
  if (!shiftRef) return null;
  // 1. Direct ID match
  const byId = (shifts || []).find(s => s && s.id === shiftRef);
  if (byId) return byId;
  // 2. Normalized name match
  const norm = normalizeShiftName(shiftRef);
  if (!norm) return null;
  return (shifts || []).find(s => s && normalizeShiftName(s.name) === norm) || null;
};

export const getCanonicalShifts = (shifts = []) => {
  const seen = new Set();
  const canonical = [];
  for (const sh of shifts || []) {
    if (!sh || sh.active === false) continue;
    const norm = normalizeShiftName(sh.name);
    if (!norm) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      canonical.push(sh);
    }
  }
  return canonical;
};

export const matchesShiftFilter = (shifts = [], student, shiftFilter) => {
  if (!shiftFilter || shiftFilter === 'All') return true;
  if (!student) return false;

  // 1. Direct ID match
  if (student.shiftId && student.shiftId === shiftFilter) return true;

  // 2. Resolve filter target name
  const filterShift = (shifts || []).find(s => s && s.id === shiftFilter);
  const targetName = filterShift ? normalizeShiftName(filterShift.name) : normalizeShiftName(shiftFilter);
  if (!targetName) return false;

  // 3. Resolve student shift name
  const studentDirectName = normalizeShiftName(student.shift);
  if (studentDirectName && studentDirectName === targetName) return true;

  const studentResolvedShift = (shifts || []).find(s => s && s.id === student.shiftId);
  const studentResolvedName = studentResolvedShift ? normalizeShiftName(studentResolvedShift.name) : '';
  if (studentResolvedName && studentResolvedName === targetName) return true;

  return false;
};

export const isShiftInPlan = (shifts = [], plan, shiftIdOrName) => {
  if (!plan) return false;
  if (!shiftIdOrName) return true;

  const planShiftIds = plan.shiftIds || (plan.shiftId ? [plan.shiftId] : []);
  if (!Array.isArray(planShiftIds) || planShiftIds.length === 0) return false;

  // 1. Direct ID inclusion
  if (planShiftIds.includes(shiftIdOrName)) return true;

  // 2. Read-time canonical alias resolution
  const reqShift = resolveCanonicalShift(shifts, shiftIdOrName);
  const targetNorm = reqShift ? normalizeShiftName(reqShift.name) : normalizeShiftName(shiftIdOrName);
  if (!targetNorm) return false;

  return planShiftIds.some(id => {
    if (id === shiftIdOrName) return true;
    const s = (shifts || []).find(item => item && item.id === id);
    return s && normalizeShiftName(s.name) === targetNorm;
  });
};

export const extractShiftTimes = (shift) => {
  if (!shift) return { startTime: null, endTime: null };
  if (shift.startTime && shift.endTime) {
    return { startTime: shift.startTime, endTime: shift.endTime };
  }
  const name = String(shift.name || '');
  const match = name.match(/(\d{1,2}:\d{2})\s*(?:-|to)\s*(\d{1,2}:\d{2})/i);
  if (match) {
    return {
      startTime: match[1].padStart(5, '0'),
      endTime: match[2].padStart(5, '0')
    };
  }
  return { startTime: null, endTime: null };
};

export const isFullDayShift = (shift) => {
  if (!shift) return false;
  const norm = normalizeShiftName(shift.name);
  return norm.includes('full day') || norm.includes('fullday') || norm.includes('full-day') || norm.includes('24 hours');
};

export const shiftsOverlap = (shA, shB) => {
  if (!shA || !shB) return false;
  if (shA.id && shB.id && shA.id === shB.id) return true;

  // Day intersection check
  const daysA = shA.daysOfWeek || [];
  const daysB = shB.daysOfWeek || [];
  if (daysA.length > 0 && daysB.length > 0) {
    const commonDay = daysA.some(d => daysB.includes(d));
    if (!commonDay) return false;
  }

  // Full Day shift check: covers all standard library operational hours on common days
  if (isFullDayShift(shA) || isFullDayShift(shB)) {
    return true;
  }

  // Time overlap check: startA < endB && startB < endA
  const timesA = extractShiftTimes(shA);
  const timesB = extractShiftTimes(shB);

  if (timesA.startTime && timesA.endTime && timesB.startTime && timesB.endTime) {
    return timesA.startTime < timesB.endTime && timesB.startTime < timesA.endTime;
  }

  // Fallback: match by normalized name if times not set and neither is Full Day
  return normalizeShiftName(shA.name) === normalizeShiftName(shB.name);
};

