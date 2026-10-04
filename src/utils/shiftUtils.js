// Shift Overlap and Scheduling Utilities

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

  // Fallback: match by normalized name if times not set
  return shA.name?.trim().toLowerCase() === shB.name?.trim().toLowerCase();
};
