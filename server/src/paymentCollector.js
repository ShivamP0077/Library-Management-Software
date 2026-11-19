import { models } from './models.js';
import { collectorIdentity } from '../../src/utils/paymentCollector.js';
import { sanitizePaymentProofs } from '../../src/utils/paymentProof.js';

const COLLECTOR_KEYS = ['collectedByUserId', 'collectedByName', 'collectedByRole'];
const CLIENT_COLLECTOR_KEYS = [...COLLECTOR_KEYS, 'operatorName', 'operatorRole', 'staffName'];

/** Authenticated user only. Client-supplied names are not read. */
export async function collectorStampFor(req) {
  const user = req?.user || {};
  let staffRole = '';
  if (user.role === 'staff' && user.staffId && req?.tenantId) {
    const staff = await models.staffMembers.findOne({ tenantId: req.tenantId, _key: String(user.staffId) }).lean();
    staffRole = staff?.role || '';
  }
  return collectorIdentity(user, { staffRole });
}

function applyProofs(body) {
  if (!Array.isArray(body.paymentProofs)) return;
  body.paymentProofs = sanitizePaymentProofs(body.paymentProofs) || [];
}

/** New payment: replace any client collector with the signed-in user. */
export function stampNewPayment(body, stamp) {
  if (!body || typeof body !== 'object') return body;
  for (const key of CLIENT_COLLECTOR_KEYS) delete body[key];
  applyProofs(body);
  Object.assign(body, stamp || {});
  return body;
}

/**
 * Update: keep a collector that was already stored.
 * An old payment with no collector stays that way (no backfill, no client-supplied collector).
 */
export function preservePaymentCollector(body, prev) {
  if (!body || typeof body !== 'object') return body;
  const had = prev && COLLECTOR_KEYS.some(key => prev[key]);
  if (had) {
    for (const key of COLLECTOR_KEYS) {
      if (prev[key]) body[key] = prev[key];
      else delete body[key];
    }
    if (prev.staffName) body.staffName = prev.staffName;
    else delete body.staffName;
  } else {
    for (const key of COLLECTOR_KEYS) delete body[key];
  }
  applyProofs(body);
  return body;
}

function rowKey(row) {
  return String(row?.receiptNo || row?.id || '').trim();
}

/** Stamp only payment rows that were not already on the student. */
export function stampPaymentHistory(history, previousHistory, stamp) {
  if (!Array.isArray(history)) return history;
  const prevList = Array.isArray(previousHistory) ? previousHistory : [];
  const prevByKey = new Map();
  for (const row of prevList) {
    const key = rowKey(row);
    if (key) prevByKey.set(key, row);
  }
  return history.map((row, index) => {
    if (!row || typeof row !== 'object') return row;
    const key = rowKey(row);
    const prev = key ? prevByKey.get(key) : (prevList[index] && !rowKey(prevList[index]) ? prevList[index] : null);
    if (prev) return preservePaymentCollector(row, prev);
    return stampNewPayment(row, stamp);
  });
}

export function stampStudentPaymentHistory(student, previous, stamp) {
  if (!student || !Array.isArray(student.paymentHistory)) return student;
  student.paymentHistory = stampPaymentHistory(student.paymentHistory, previous?.paymentHistory, stamp);
  return student;
}
