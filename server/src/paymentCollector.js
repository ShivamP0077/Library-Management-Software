import { models, Settings } from './models.js';
import { isOwnerRole } from './amountPermission.js';
import { collectorIdentity } from '../../src/utils/paymentCollector.js';
import {
  sanitizePaymentProofs,
  paymentProofModeOf,
  paymentProofsEqual,
  paymentProofsMissing,
  PAYMENT_PROOF_REQUIRED_MESSAGE,
} from '../../src/utils/paymentProof.js';

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

/** Mode + whether this user may change proofs on an existing payment. */
export async function proofPolicyFor(req) {
  const settings = req._proofSettings || (await Settings.findOne({ tenantId: req.tenantId }).lean()) || {};
  req._proofSettings = settings;
  return {
    mode: paymentProofModeOf(settings),
    canEditProofs: isOwnerRole(req.user),
  };
}

export function proofRequiredError() {
  const err = new Error(PAYMENT_PROOF_REQUIRED_MESSAGE);
  err.status = 400;
  err.code = 'payment_proof_required';
  return err;
}

function applyProofs(body) {
  if (!Array.isArray(body.paymentProofs)) return;
  body.paymentProofs = sanitizePaymentProofs(body.paymentProofs) || [];
}

/**
 * Apply the library's proof setting to a payment row.
 * Create: OFF drops proofs; REQUIRED needs at least one photo.
 * Update: only the owner/admin may change proofs; staff keep the stored list.
 */
export function applyPaymentProofPolicy(body, prev, policy = {}, { isCreate = !prev } = {}) {
  if (!body || typeof body !== 'object') return body;
  const mode = paymentProofModeOf({ paymentProofMode: policy.mode });
  const canEdit = policy.canEditProofs === true;

  if (isCreate) {
    if (mode === 'OFF') {
      delete body.paymentProofs;
      return body;
    }
    applyProofs(body);
    if (paymentProofsMissing(mode, body.paymentProofs)) throw proofRequiredError();
    return body;
  }

  if (!canEdit) {
    if (Array.isArray(prev?.paymentProofs)) body.paymentProofs = sanitizePaymentProofs(prev.paymentProofs) || [];
    else delete body.paymentProofs;
    return body;
  }

  if (!Array.isArray(body.paymentProofs)) {
    if (Array.isArray(prev?.paymentProofs)) body.paymentProofs = sanitizePaymentProofs(prev.paymentProofs) || [];
    return body;
  }
  applyProofs(body);
  if (paymentProofsMissing(mode, body.paymentProofs)) throw proofRequiredError();
  return body;
}

export function paymentProofsChanged(prev, next) {
  return !paymentProofsEqual(prev?.paymentProofs, next?.paymentProofs);
}

/** New payment: replace any client collector with the signed-in user. */
export function stampNewPayment(body, stamp, policy) {
  if (!body || typeof body !== 'object') return body;
  for (const key of CLIENT_COLLECTOR_KEYS) delete body[key];
  applyPaymentProofPolicy(body, null, policy, { isCreate: true });
  Object.assign(body, stamp || {});
  return body;
}

/**
 * Update: keep a collector that was already stored.
 * An old payment with no collector stays that way (no backfill, no client-supplied collector).
 */
export function preservePaymentCollector(body, prev, policy) {
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
  applyPaymentProofPolicy(body, prev, policy, { isCreate: false });
  return body;
}

function rowKey(row) {
  return String(row?.receiptNo || row?.id || '').trim();
}

/** Stamp only payment rows that were not already on the student. */
export function stampPaymentHistory(history, previousHistory, stamp, policy) {
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
    if (prev) return preservePaymentCollector(row, prev, policy);
    return stampNewPayment(row, stamp, policy);
  });
}

export function stampStudentPaymentHistory(student, previous, stamp, policy) {
  if (!student || !Array.isArray(student.paymentHistory)) return student;
  student.paymentHistory = stampPaymentHistory(student.paymentHistory, previous?.paymentHistory, stamp, policy);
  return student;
}
