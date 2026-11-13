// Per-library Skip / Later for the dashboard Action required list.
import express from 'express';
import { Settings } from './models.js';
import { todayIn } from './finance.js';
import { normalizeDismissals, validateDismissals } from '../../src/utils/actionDismissals.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createActionDismissalRouter() {
  const r = express.Router();

  r.get('/dashboard/action-dismissals', wrap(async (req, res) => {
    const s = await Settings.findOne({ tenantId: req.tenantId }).lean();
    res.json(normalizeDismissals(s?.actionDismissals || {}, todayIn()));
  }));

  r.put('/dashboard/action-dismissals', wrap(async (req, res) => {
    const saved = validateDismissals(req.body, todayIn());
    await Settings.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: { actionDismissals: saved, tenantId: req.tenantId, libraryId: req.tenantId } },
      { upsert: true, new: true },
    );
    res.json(saved);
  }));

  return r;
}
