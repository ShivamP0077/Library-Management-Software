// Issue #19: Super Admin payment-provider settings + deletion-request resolve.
import express from 'express';
import { requireRole } from './auth.js';
import { audit } from './audit.js';
import { getPaymentConfigPublic, updatePaymentConfig, refreshPaymentProvider, testPaymentConnection } from './paymentConfig.js';
import { Library, User } from './models.js';
import { sendMail } from './mailer.js';
import { paymentProvider } from './billing.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createPaymentsAdminRouter() {
  const r = express.Router();
  r.use(requireRole('superadmin'));

  r.get('/payments/config', wrap(async (_req, res) => {
    res.json(await getPaymentConfigPublic());
  }));

  r.put('/payments/config', wrap(async (req, res) => {
    const view = await updatePaymentConfig(req.body, { updatedBy: req.user.email });
    await audit(req, 'payments.config_updated', {
      detail: {
        activeProvider: view.activeProvider,
        razorpayEnabled: view.razorpay.enabled,
        paypalEnabled: view.paypal.enabled,
        // never log secrets
      },
    });
    res.json(view);
  }));

  r.post('/payments/config/test', wrap(async (req, res) => {
    const view = await testPaymentConnection();
    await audit(req, 'payments.provider_verified', { detail: { provider: view.verification?.provider, mode: view.verification?.mode } });
    res.json({ ok: true, ...view });
  }));

  /** Libraries that asked to be deleted — Super Admin acts via existing delete flow. */
  r.get('/payments/deletion-requests', wrap(async (_req, res) => {
    const libs = await Library.find({ deletionRequest: { $ne: null } })
      .select('libraryId name contactEmail deletionRequest subscription planId status')
      .lean();
    res.json(libs.map(l => ({
      libraryId: l.libraryId,
      name: l.name,
      contactEmail: l.contactEmail,
      planId: l.planId,
      status: l.status,
      subscriptionStatus: l.subscription?.status || null,
      deletionRequest: l.deletionRequest,
    })));
  }));

  r.post('/payments/deletion-requests/:libraryId/resolve', wrap(async (req, res) => {
    const { libraryId } = req.params;
    const action = req.body?.action === 'dismiss' ? 'dismiss' : 'acknowledge';
    const lib = await Library.findOne({ libraryId });
    if (!lib) return res.status(404).json({ error: 'Library not found' });
    if (!lib.deletionRequest) return res.status(400).json({ error: 'No deletion request' });
    if (action === 'dismiss') {
      await Library.updateOne({ libraryId }, { $set: { deletionRequest: null } });
      await audit(req, 'library.deletion_request_dismissed', { tenantId: libraryId });
    } else {
      await Library.updateOne({ libraryId }, {
        $set: {
          'deletionRequest.acknowledgedAt': new Date(),
          'deletionRequest.acknowledgedBy': req.user.email,
        },
      });
      await audit(req, 'library.deletion_request_acked', { tenantId: libraryId });
    }
    res.json({ ok: true, action });
  }));

  return r;
}

/** Email every Super Admin when an owner requests deletion. */
export async function notifySuperAdminsOfDeletionRequest(lib, request) {
  const admins = await User.find({ role: 'superadmin' }).select('email').lean();
  const to = admins.map(a => a.email).filter(Boolean);
  if (!to.length) return;
  const text = [
    `Library "${lib.name}" (${lib.libraryId}) requested deletion.`,
    `Requested by: ${request.by}`,
    `Reason: ${request.reason || '(none)'}`,
    '',
    'Open Super Admin → Payments / Business dashboard to review. Deleting still requires typing the library name.',
  ].join('\n');
  await Promise.all(to.map(email => sendMail({
    to: email,
    subject: `[Library OS] Deletion requested: ${lib.name}`,
    text,
  }).catch(e => console.error('[mail] deletion alert failed:', e.message))));
}
