#!/usr/bin/env node
/**
 * One-off check for a software invoice whose Razorpay payment was captured
 * but the invoice was left past_due. Dry-run unless APPLY=1.
 *
 * The live webhook stored the payment-link id on the invoice and then compared
 * it with the payment id. This script confirms the captured payment belongs to
 * that link, and only then settles.
 *
 * Usage (from the repo root or from server/):
 *   node server/scripts/reconcile-software-invoice.mjs inv_aaa pay_bbb
 *   APPLY=1 node server/scripts/reconcile-software-invoice.mjs inv_aaa pay_bbb
 *
 * APPLY=1 was not used when this script was added. It writes only when you set it.
 * Output is invoice id, library id, statuses, and amount. It does not print
 * keys, phone, UPI VPA, email, or the raw payment.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import { getPaymentConfig } from '../src/paymentConfig.js';
import { decryptSecret } from '../src/cryptoSecrets.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { paymentMatchesPaymentLink } from '../src/payments/razorpayProvider.js';
import { settleInvoice } from '../src/payments/settlement.js';
import { Library } from '../src/models.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEnv = path.join(serverDir, '.env');
const rootEnv = path.join(serverDir, '..', '.env');
if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv });
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

const apply = process.env.APPLY === '1';
const [invoiceId, paymentId] = process.argv.slice(2);

if (!invoiceId || !paymentId || invoiceId.startsWith('-') || paymentId.startsWith('-')) {
  console.error('Usage: node server/scripts/reconcile-software-invoice.mjs <invoiceId> <paymentId>');
  console.error('Dry-run is the default. Set APPLY=1 to settle after the checks pass.');
  process.exit(2);
}

function noteBag(notes) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {};
  return notes;
}

function storedPlinkId(invoice) {
  for (const ref of [invoice?.providerRef, invoice?.providerOrderRef]) {
    if (typeof ref === 'string' && ref.startsWith('plink_')) return ref;
  }
  return null;
}

async function rzGet(apiPath, keyId, keySecret) {
  const res = await fetch(`https://api.razorpay.com/v1${apiPath}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) {
    const err = new Error('razorpay_request_failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function main() {
  let connected = false;
  try {
    await connectDB();
    connected = true;
  } catch (e) {
    const msg = e?.message === 'MONGODB_URI is not set' ? e.message : 'Could not connect to the database.';
    console.error(`[reconcile] ${msg} Nothing was changed.`);
    return 2;
  }

  try {
    const invoice = await SoftwareInvoice.findOne({ invoiceId }).lean();
    if (!invoice) {
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', invoiceId, found: false, wouldSettle: false, reason: 'invoice_not_found' }));
      return 1;
    }

    const config = await getPaymentConfig();
    const rz = config?.razorpay;
    if (!rz?.keyId || !rz?.keySecretEnc) {
      console.error('[reconcile] Razorpay is not configured. Nothing was changed.');
      return 2;
    }
    let keySecret;
    try { keySecret = decryptSecret(rz.keySecretEnc); } catch {
      console.error('[reconcile] Could not read the Razorpay secret. Nothing was changed.');
      return 2;
    }
    if (!keySecret) {
      console.error('[reconcile] Razorpay secret is empty. Nothing was changed.');
      return 2;
    }

    let payment;
    try {
      payment = await rzGet(`/payments/${encodeURIComponent(paymentId)}`, rz.keyId, keySecret);
    } catch {
      console.error('[reconcile] Could not fetch that payment from Razorpay. Nothing was changed.');
      return 1;
    }

    const notes = noteBag(payment.notes);
    const plinkId = storedPlinkId(invoice);
    const paidMinor = Math.round(Number(payment.amount));
    const expectedMinor = Math.round(Number(invoice.gatewayMinor));
    const reasons = [];
    if (invoice.status === 'paid') reasons.push('already_paid');
    else if (!['open', 'past_due'].includes(invoice.status)) reasons.push('invoice_not_claimable');
    if (payment.status !== 'captured') reasons.push('payment_not_captured');
    if (!(expectedMinor > 0) || paidMinor !== expectedMinor) reasons.push('amount_mismatch');
    if (invoice.currency && payment.currency && String(invoice.currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
      reasons.push('currency_mismatch');
    }
    if (String(notes.invoiceId || '') !== String(invoice.invoiceId)) reasons.push('invoice_note_mismatch');
    if (notes.tenantId && String(notes.tenantId) !== String(invoice.tenantId)) reasons.push('tenant_note_mismatch');
    if (invoice.provider && invoice.provider !== 'razorpay') reasons.push('provider_mismatch');

    if (!plinkId) reasons.push('no_payment_link');
    else {
      let onLink = false;
      let fetched = false;
      try {
        const link = await rzGet(`/payment_links/${encodeURIComponent(plinkId)}`, rz.keyId, keySecret);
        fetched = true;
        onLink = paymentMatchesPaymentLink(link, payment);
      } catch {
        fetched = false;
      }
      if (!onLink && !fetched) {
        const noteLink = notes.paymentLinkId || notes.payment_link_id;
        if (noteLink && String(noteLink) === String(plinkId)) onLink = true;
      }
      if (!onLink) reasons.push(fetched ? 'payment_not_on_link' : 'payment_link_lookup_failed');
    }

    const wouldSettle = reasons.length === 0;
    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      invoiceId: invoice.invoiceId,
      tenantId: invoice.tenantId,
      invoiceStatus: invoice.status,
      paymentStatus: payment.status || null,
      amountMinor: Number.isFinite(paidMinor) ? paidMinor : null,
      wouldSettle,
      ...(wouldSettle ? {} : { reason: reasons[0] }),
    };

    if (!apply) {
      console.log(JSON.stringify(summary));
      console.log('Dry run only. No invoice was settled.');
      return wouldSettle ? 0 : 1;
    }
    if (!wouldSettle) {
      console.log(JSON.stringify(summary));
      console.log('Checks failed. Nothing was settled.');
      return 1;
    }

    const settled = await settleInvoice(invoice.invoiceId, {
      providerRef: payment.id,
      providerOrderRef: plinkId,
      gatewayMinor: paidMinor,
      currency: payment.currency || invoice.currency,
      provider: 'razorpay',
      source: 'razorpay',
      raw: {
        source: 'reconcile-software-invoice',
        paymentId: payment.id,
        status: payment.status,
        amount: paidMinor,
        currency: payment.currency || null,
        orderId: payment.order_id || null,
      },
    });
    const fresh = await SoftwareInvoice.findOne({ invoiceId: invoice.invoiceId }).lean();
    const lib = await Library.findOne({ libraryId: invoice.tenantId }).lean();
    console.log(JSON.stringify({
      invoiceId: invoice.invoiceId,
      invoiceStatus: fresh?.status || settled.invoice?.status || null,
      subscriptionStatus: lib?.subscription?.status || null,
      ...(settled.ok ? {} : { error: settled.error || 'settlement_failed' }),
    }));
    return settled.ok ? 0 : 1;
  } finally {
    if (connected) await mongoose.disconnect();
  }
}

main().then((code) => {
  process.exit(code ?? 0);
}).catch((e) => {
  const safe = e?.message === 'MONGODB_URI is not set' ? e.message : 'Reconcile failed. Nothing further was changed.';
  console.error(`[reconcile] ${safe}`);
  mongoose.disconnect().catch(() => {}).finally(() => process.exit(1));
});
