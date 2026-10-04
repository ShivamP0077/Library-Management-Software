/**
 * Pure utility for managing dynamic N-way split payment breakdowns with auto-balancing.
 */

export function handleSplitAmountChange(rows, editedIndex, newAmount, totalPayable) {
  const parsedAmount = Math.max(0, Number(newAmount) || 0);
  
  // Clone rows and mark edited row as manual
  const newRows = rows.map((r, i) => ({
    ...r,
    amount: i === editedIndex ? parsedAmount : (Number(r.amount) || 0),
    isManual: i === editedIndex ? true : Boolean(r.isManual)
  }));

  // Identify the balancing row:
  // 1. Look for a row other than editedIndex that is NOT manual (isManual === false).
  // 2. If all other rows are marked manual, pick the other row (preferring the latest other row).
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
    const otherSum = newRows.reduce((sum, r, i) => (i !== balancingIndex ? sum + (Number(r.amount) || 0) : sum), 0);
    const remainder = Math.max(0, totalPayable - otherSum);
    newRows[balancingIndex].amount = remainder;
    newRows[balancingIndex].isManual = false; // Mark as auto-balanced
  }

  return newRows;
}

export function handleAddSplitComponent(rows, totalPayable) {
  const currentSum = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const remainder = Math.max(0, totalPayable - currentSum);

  return [
    ...rows,
    {
      method: '',
      amount: remainder > 0 ? remainder : '',
      isManual: false
    }
  ];
}

export function handleRemoveSplitComponent(rows, removeIndex, totalPayable) {
  const filtered = rows.filter((_, i) => i !== removeIndex);
  if (filtered.length === 1) {
    filtered[0].amount = totalPayable;
    filtered[0].isManual = false;
  } else if (filtered.length > 1) {
    const lastIdx = filtered.length - 1;
    const otherSum = filtered.reduce((sum, r, i) => (i !== lastIdx ? sum + (Number(r.amount) || 0) : sum), 0);
    filtered[lastIdx].amount = Math.max(0, totalPayable - otherSum);
    filtered[lastIdx].isManual = false;
  }
  return filtered;
}

export function validateSplitPayment(rows, totalPayable, supportedMethods = ['UPI', 'Cash', 'Card', 'Bank Transfer']) {
  if (!rows || rows.length < 2) {
    return { valid: false, error: "Split payment requires at least 2 payment components." };
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
    if (isNaN(amt) || amt <= 0) {
      return { valid: false, error: `Row ${i + 1} (${row.method}): Amount must be greater than zero.` };
    }
    totalSum += amt;
  }

  if (totalSum !== totalPayable) {
    return {
      valid: false,
      error: `Split sum (₹${totalSum.toLocaleString()}) must equal net payable amount (₹${totalPayable.toLocaleString()}).`
    };
  }

  return { valid: true, error: null };
}
