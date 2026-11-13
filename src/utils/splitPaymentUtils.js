/**
 * Pure utility for managing dynamic N-way split payment breakdowns with auto-balancing.
 *
 * Invariants:
 * - Amounts are whole numbers (integers) and never negative.
 * - No single row may exceed the total payable.
 * - When a non-Cash row is edited and a Cash row exists, Cash is the balancing row.
 * - An auto-balanced Cash row that becomes 0 is removed (at least one row is kept).
 */

const toWholeAmount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const clampToTotal = (value, total) => Math.min(toWholeAmount(value), total);

/**
 * Calculate the amount that should sit in the Cash row so that
 * every non-Cash row plus Cash equals the total payable.
 */
export function computeCashRemainder(rows, totalPayable) {
  const total = toWholeAmount(totalPayable);
  if (!Array.isArray(rows)) return total;

  const nonCashSum = rows.reduce((sum, row) => {
    if (row?.method === 'Cash') return sum;
    return sum + clampToTotal(row?.amount, total);
  }, 0);

  return Math.max(0, total - nonCashSum);
}

export function handleSplitAmountChange(rows, editedIndex, newAmount, totalPayable) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (editedIndex < 0 || editedIndex >= rows.length) return rows;

  const total = toWholeAmount(totalPayable);

  // Clone rows, normalise amounts and mark the edited row as manual.
  let newRows = rows.map((row, i) => ({
    ...row,
    amount: i === editedIndex ? clampToTotal(newAmount, total) : clampToTotal(row?.amount, total),
    isManual: i === editedIndex ? true : Boolean(row?.isManual)
  }));

  const editedIsCash = newRows[editedIndex].method === 'Cash';
  const cashIndex = editedIsCash
    ? -1
    : newRows.findIndex((row, i) => i !== editedIndex && row.method === 'Cash');

  // Cash-first balancing: a non-Cash edit makes the Cash row the remainder holder.
  if (cashIndex !== -1) {
    const otherSum = newRows.reduce((sum, row, i) => (
      i === editedIndex || i === cashIndex ? sum : sum + row.amount
    ), 0);

    // Never let the edited row push the other rows over the total.
    const maxForEdited = Math.max(0, total - otherSum);
    newRows[editedIndex].amount = Math.min(newRows[editedIndex].amount, maxForEdited);

    const cashRemainder = Math.max(0, total - otherSum - newRows[editedIndex].amount);
    newRows[cashIndex].amount = cashRemainder;
    newRows[cashIndex].isManual = false;

    if (cashRemainder === 0 && newRows.length > 1) {
      newRows = newRows.filter((_, i) => i !== cashIndex);
    }

    return newRows;
  }

  // Fallback: keep the previous balancing behaviour when Cash is not available.
  let balancingIndex = -1;
  for (let i = newRows.length - 1; i >= 0; i--) {
    if (i !== editedIndex && !newRows[i].isManual) {
      balancingIndex = i;
      break;
    }
  }
  if (balancingIndex === -1 && newRows.length > 1) {
    balancingIndex = (editedIndex === newRows.length - 1) ? editedIndex - 1 : newRows.length - 1;
  }

  if (balancingIndex !== -1) {
    const otherSum = newRows.reduce((sum, row, i) => (
      i === balancingIndex ? sum : sum + row.amount
    ), 0);
    const remainder = Math.max(0, total - otherSum);
    newRows[balancingIndex].amount = remainder;
    newRows[balancingIndex].isManual = false;
  }

  return newRows;
}

export function handleAddSplitComponent(rows, totalPayable) {
  const total = toWholeAmount(totalPayable);
  const safeRows = Array.isArray(rows) ? rows : [];
  const currentSum = safeRows.reduce((sum, row) => sum + clampToTotal(row?.amount, total), 0);
  const remainder = Math.max(0, total - currentSum);

  return [
    ...safeRows.map(row => ({
      ...row,
      amount: clampToTotal(row?.amount, total)
    })),
    {
      method: '',
      amount: remainder > 0 ? remainder : '',
      isManual: false
    }
  ];
}

export function handleRemoveSplitComponent(rows, removeIndex, totalPayable) {
  if (!Array.isArray(rows)) return [];

  const total = toWholeAmount(totalPayable);
  const filtered = rows
    .filter((_, i) => i !== removeIndex)
    .map(row => ({
      ...row,
      amount: clampToTotal(row?.amount, total)
    }));

  if (filtered.length === 1) {
    filtered[0].amount = total;
    filtered[0].isManual = false;
  } else if (filtered.length > 1) {
    const lastIdx = filtered.length - 1;
    const otherSum = filtered.reduce((sum, row, i) => (
      i !== lastIdx ? sum + row.amount : sum
    ), 0);
    filtered[lastIdx].amount = Math.max(0, total - otherSum);
    filtered[lastIdx].isManual = false;
  }

  return filtered;
}

export function validateSplitPayment(rows, totalPayable, supportedMethods = ['UPI', 'Cash', 'Card', 'Bank Transfer', 'Net Banking', 'Cheque']) {
  if (!rows || rows.length < 2) {
    return { valid: false, error: "Split payment requires at least 2 payment components." };
  }

  const total = Number(totalPayable);
  if (!Number.isFinite(total) || total < 0) {
    return { valid: false, error: "Net payable amount must be a non-negative number." };
  }

  const seenMethods = new Set();
  let totalSum = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.method) {
      return { valid: false, error: `Row ${i + 1}: Please select a payment method.` };
    }
    if (!supportedMethods.includes(row.method)) {
      return { valid: false, error: `Row ${i + 1}: Unsupported payment method "${row.method}".` };
    }
    if (seenMethods.has(row.method)) {
      return { valid: false, error: `Duplicate payment method "${row.method}". Each component must have a unique method.` };
    }
    seenMethods.add(row.method);

    const amt = Number(row.amount);
    if (!Number.isFinite(amt)) {
      return { valid: false, error: `Row ${i + 1} (${row.method}): Amount must be a valid number.` };
    }
    if (amt < 0) {
      return { valid: false, error: `Row ${i + 1} (${row.method}): Amount cannot be negative.` };
    }
    if (!Number.isInteger(amt)) {
      return { valid: false, error: `Row ${i + 1} (${row.method}): Amount must be a whole number.` };
    }
    if (amt === 0) {
      return { valid: false, error: `Row ${i + 1} (${row.method}): Amount must be greater than zero.` };
    }
    if (amt > total) {
      return { valid: false, error: `Row ${i + 1} (${row.method}): Amount cannot exceed the net payable amount (₹${total.toLocaleString()}).` };
    }

    totalSum += amt;
  }

  if (totalSum > total) {
    return {
      valid: false,
      error: `Split sum (₹${totalSum.toLocaleString()}) cannot exceed net payable amount (₹${total.toLocaleString()}).`
    };
  }

  if (totalSum !== total) {
    return {
      valid: false,
      error: `Split sum (₹${totalSum.toLocaleString()}) must equal net payable amount (₹${total.toLocaleString()}).`
    };
  }

  return { valid: true, error: null };
}
