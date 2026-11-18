export function catalogueUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/api/public/software-plans`;
}

export function intervalPrice(plan, interval) {
  return (plan?.intervals || []).find(row => row.interval === interval && row.available) || null;
}

export function recommendedId(plans) {
  return (plans || []).find(plan => plan.recommended)?.planId || null;
}

export function formatInrFromMinor(minor) {
  const rupees = Number(minor || 0) / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
