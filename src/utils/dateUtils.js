/**
 * Calendar-based Subscription and Billing Utilities
 * 
 * Implements strict calendar month arithmetic (respecting 28/29/30/31 day months),
 * anniversary billing, grace period calculations, and custom due-date extensions.
 */

/**
 * Format a Date object to 'YYYY-MM-DD'
 */
export function formatDate(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse 'YYYY-MM-DD' safely without timezone offset issues
 */
export function parseDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return new Date(dateStr.getTime());
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d, 12, 0, 0); // Noon prevents any midnight daylight-saving drift
  }
  return new Date(dateStr);
}

/**
 * Add calendar months to a start date and subtract 1 day to get the period expiry.
 * 
 * Example:
 * 15 Feb + 1 month -> 14 March
 * 15 March + 1 month -> 14 April
 * 15 April + 1 month -> 14 May
 * 31 Jan + 1 month (non-leap) -> 27 Feb (ends 1 day before clamped 28 Feb)
 */
export function calculateSubscriptionExpiry(startDate, durationMonths = 1) {
  const d = parseDate(startDate);
  const numMonths = Math.max(1, parseInt(durationMonths, 10) || 1);

  const startDay = d.getDate();
  const startMonth = d.getMonth();
  const startYear = d.getFullYear();

  const totalMonths = startMonth + numMonths;
  const targetYear = startYear + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Number of days in target month (e.g. 28, 29, 30, 31)
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(startDay, daysInTargetMonth);

  // Target anniversary boundary
  const targetBoundary = new Date(targetYear, targetMonth, targetDay, 12, 0, 0);

  // Expiry is 1 day before the next period starts
  targetBoundary.setDate(targetBoundary.getDate() - 1);

  return formatDate(targetBoundary);
}

/**
 * Calculate the next renewal start date based on current expiry.
 * If current expiry is in future or today, new period starts on expiry + 1 day.
 * If current expiry is in the past, new period starts today.
 */
export function calculateRenewalStartDate(currentExpiryDate) {
  if (!currentExpiryDate) return formatDate(new Date());
  const expiry = parseDate(currentExpiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiryMidnight = new Date(expiry);
  expiryMidnight.setHours(0, 0, 0, 0);

  if (expiryMidnight >= today) {
    // Active: next day after expiry
    const nextStart = new Date(expiry);
    nextStart.setDate(nextStart.getDate() + 1);
    return formatDate(nextStart);
  } else {
    // Expired: starts today
    return formatDate(today);
  }
}

/**
 * Calculate effective student status considering grace period and custom extensions
 * 
 * @param {Object} student 
 * @param {number} defaultGraceDays 
 * @returns {{ status: 'Active' | 'Grace Period' | 'Expired', label: string, isGrace: boolean, daysRemaining: number }}
 */
export function getSubscriptionStatus(student, defaultGraceDays = 3) {
  if (!student) return { status: 'Active', label: 'Active', isGrace: false, daysRemaining: 0 };
  if (student.status === 'Cancelled') return { status: 'Cancelled', label: 'Cancelled', isGrace: false, daysRemaining: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = parseDate(student.expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const graceDays = student.customGraceDays != null ? Number(student.customGraceDays) : Number(defaultGraceDays || 0);
  
  // Effective due date may have an individual student extension
  let effectiveDueDate = new Date(expiry);
  if (student.extendedDueDate) {
    const ext = parseDate(student.extendedDueDate);
    ext.setHours(0, 0, 0, 0);
    if (ext > effectiveDueDate) {
      effectiveDueDate = ext;
    }
  }

  const graceBoundary = new Date(effectiveDueDate);
  graceBoundary.setDate(graceBoundary.getDate() + graceDays);

  const diffTime = effectiveDueDate.getTime() - today.getTime();
  const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (today <= effectiveDueDate) {
    return {
      status: 'Active',
      label: 'Active',
      isGrace: false,
      daysRemaining: daysUntilDue
    };
  }

  if (today <= graceBoundary) {
    const graceDiff = graceBoundary.getTime() - today.getTime();
    const graceDaysLeft = Math.ceil(graceDiff / (1000 * 60 * 60 * 24));
    return {
      status: 'Grace Period',
      label: `Grace (${graceDaysLeft}d left)`,
      isGrace: true,
      daysRemaining: graceDaysLeft
    };
  }

  const overdueDiff = today.getTime() - effectiveDueDate.getTime();
  const overdueDays = Math.ceil(overdueDiff / (1000 * 60 * 60 * 24));
  return {
    status: 'Expired',
    label: `Expired (${overdueDays}d ago)`,
    isGrace: false,
    daysRemaining: -overdueDays
  };
}
