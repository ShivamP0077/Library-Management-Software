// Issue #15: persistent, unique registration confirmation. It is not a payment receipt.
import crypto from 'crypto';
import mongoose from 'mongoose';
import { sendMail } from './mailer.js';
import { sendMobileMessage } from './messaging.js';
import { textToPdf } from './pdf.js';

const schema = new mongoose.Schema({
  confirmationNumber: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, unique: true, index: true },
  ownerUserId: { type: String, index: true },
  libraryId: String,
  libraryName: String,
  ownerName: String,
  email: String,
  mobile: String,
  planId: String,
  planName: String,
  interval: String,
  subscriptionStatus: String,
  paymentStatus: { type: String, enum: ['trial', 'paid', 'unpaid', 'free'], default: 'unpaid' },
  isPaymentReceipt: { type: Boolean, default: false },
  trialEndsAt: Date,
  registeredAt: { type: Date, default: Date.now },
  supportContact: String,
  channel: { type: String, enum: ['email', 'mobile'], default: 'email' },
  delivery: {
    status: { type: String, enum: ['pending', 'sent', 'logged', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date,
    sentAt: Date,
    reason: String,
    history: { type: [{ at: Date, channel: String, target: String, status: String, reason: String }], default: [] },
  },
}, { timestamps: true });
export const RegistrationConfirmation = mongoose.models.RegistrationConfirmation
  || mongoose.model('RegistrationConfirmation', schema);

/** Address shown to owners. SMTP_FROM is the sending mailbox and is not used here. */
export const supportContact = () => String(process.env.SUPPORT_EMAIL || '').trim() || 'mylibraryosadmin@gmail.com';

const newNumber = () => `REG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

export function paymentLabel(subscription) {
  const status = subscription?.status;
  if (status === 'trialing') return 'trial';
  if (status === 'active' && Number(subscription?.price || 0) === 0) return 'free';
  if (status === 'active') return 'paid';
  return 'unpaid';
}

export async function createRegistrationConfirmation({ library, user, plan, subscription, via = 'email' }) {
  const channel = via === 'mobile' ? 'mobile' : 'email';
  const detail = {
    confirmationNumber: newNumber(),
    tenantId: library.libraryId,
    ownerUserId: user?._id ? String(user._id) : undefined,
    libraryId: library.libraryId,
    libraryName: library.name,
    ownerName: user?.name || '',
    email: user?.email || library.contactEmail || '',
    mobile: user?.mobile || library.phone || '',
    planId: plan?.planId || subscription?.planId || null,
    planName: plan?.name || null,
    interval: subscription?.interval || 'month',
    subscriptionStatus: subscription?.status || null,
    paymentStatus: paymentLabel(subscription),
    isPaymentReceipt: false,
    trialEndsAt: subscription?.trialEndsAt || null,
    registeredAt: new Date(),
    supportContact: supportContact(),
    channel,
    delivery: { status: 'pending', attempts: 0 },
  };
  const doc = await RegistrationConfirmation.findOneAndUpdate(
    { tenantId: library.libraryId },
    { $setOnInsert: detail },
    { upsert: true, new: true, lean: false },
  );
  return doc;
}

export function registrationConfirmationPdf(doc, library) {
  return textToPdf(registrationConfirmationText(doc, library));
}

export function registrationConfirmationText(doc, library) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const pay = d.paymentStatus === 'trial' ? 'Free trial — no payment has been received'
    : d.paymentStatus === 'paid' ? 'Paid — see Billing History for the payment receipt'
    : d.paymentStatus === 'free' ? 'Free plan — no payment is due'
    : 'Unpaid — this is not a payment receipt';
  return [
    'MY LIBRARY OS — REGISTRATION CONFIRMATION',
    `Confirmation number: ${d.confirmationNumber}`,
    `Library: ${d.libraryName || library?.name || ''} (Library ID: ${d.libraryId || d.tenantId})`,
    `Owner: ${d.ownerName || ''}`,
    d.email ? `Email: ${d.email}` : null,
    d.mobile ? `Mobile: ${d.mobile}` : null,
    `Registered: ${new Date(d.registeredAt || d.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    `Plan: ${d.planName || d.planId || 'None'}${d.interval ? ` (${d.interval})` : ''}`,
    `Subscription status: ${d.subscriptionStatus || 'not started'}`,
    d.trialEndsAt ? `Trial ends: ${new Date(d.trialEndsAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : null,
    `Account status: ${pay}`,
    '',
    'This confirmation proves account creation only. It is NOT proof of plan payment.',
    `Support: ${d.supportContact || supportContact()}`,
  ].filter(Boolean).join('\n');
}

/** Sends through the verified channel; failures are recorded and can be retried. */
export async function deliverRegistrationConfirmation(docId) {
  const doc = await RegistrationConfirmation.findById(docId);
  if (!doc) return null;
  const text = registrationConfirmationText(doc);
  doc.delivery.attempts = Number(doc.delivery.attempts || 0) + 1;
  doc.delivery.lastAttemptAt = new Date();
  let result;
  if (doc.channel === 'mobile') {
    if (!doc.mobile) {
      result = { sent: false, logged: true, reason: 'no_verified_mobile' };
    } else {
      result = await sendMobileMessage({ to: doc.mobile, text });
    }
  } else {
    if (!doc.email) {
      result = { sent: false, logged: true, reason: 'no_verified_email' };
    } else {
      const sent = await sendMail({ to: doc.email, subject: `My Library OS registration confirmed — ${doc.confirmationNumber}`, text });
      result = sent ? { sent: true } : { sent: false, logged: true, reason: 'email_transport_not_configured' };
    }
  }
  doc.delivery.status = result.sent ? 'sent' : (result.logged ? 'logged' : 'failed');
  doc.delivery.sentAt = result.sent ? new Date() : doc.delivery.sentAt;
  doc.delivery.reason = result.reason || undefined;
  if (!Array.isArray(doc.delivery.history)) doc.delivery.history = [];
  const target = doc.channel === 'mobile' ? doc.mobile : doc.email;
  doc.delivery.history.push({
    at: new Date(),
    channel: doc.channel,
    target: target ? String(target).replace(/^(.{2}).*(@.*)$/, '$1***$2').replace(/^(\d{2}).*(\d{4})$/, '$1****$2') : null,
    status: doc.delivery.status,
    reason: result.reason || null,
  });
  await doc.save();
  return doc;
}
