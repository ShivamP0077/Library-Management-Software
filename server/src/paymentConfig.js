// Issue #19: Super Admin payment-provider configuration (Razorpay first, PayPal option).
import mongoose from 'mongoose';
import { encryptSecret, decryptSecret, maskSecret } from './cryptoSecrets.js';
import { setPaymentProvider } from './billing.js';
import { createRazorpayProvider } from './payments/razorpayProvider.js';
import { createPaypalProvider } from './payments/paypalProvider.js';

const schema = new mongoose.Schema({
  _id: { type: String, default: 'default' },
  activeProvider: { type: String, enum: ['none', 'razorpay', 'paypal'], default: 'none' },
  razorpay: {
    enabled: { type: Boolean, default: false },
    keyId: { type: String, default: '' },
    keySecretEnc: { type: String, default: '' },
    webhookSecretEnc: { type: String, default: '' },
    mode: { type: String, enum: ['test', 'live'], default: 'test' },
  },
  paypal: {
    enabled: { type: Boolean, default: false },
    clientId: { type: String, default: '' },
    clientSecretEnc: { type: String, default: '' },
    webhookId: { type: String, default: '' },
    mode: { type: String, enum: ['sandbox', 'live'], default: 'sandbox' },
  },
  verification: { provider: String, mode: String, status: String, at: Date, message: String },
  updatedBy: String,
  updatedAt: Date,
}, { collection: 'payment_provider_config' });

export const PaymentProviderConfig = mongoose.models.PaymentProviderConfig
  || mongoose.model('PaymentProviderConfig', schema);

function publicView(doc) {
  const d = doc?.toObject ? doc.toObject() : (doc || {});
  return {
    activeProvider: d.activeProvider || 'none',
    razorpay: {
      enabled: Boolean(d.razorpay?.enabled),
      keyId: d.razorpay?.keyId || '',
      keySecretSet: Boolean(d.razorpay?.keySecretEnc),
      keySecretMask: d.razorpay?.keySecretEnc ? '••••••••' : '',
      webhookSecretSet: Boolean(d.razorpay?.webhookSecretEnc),
      mode: d.razorpay?.mode || 'test',
    },
    paypal: {
      enabled: Boolean(d.paypal?.enabled),
      clientId: d.paypal?.clientId || '',
      clientSecretSet: Boolean(d.paypal?.clientSecretEnc),
      webhookId: d.paypal?.webhookId || '',
      mode: d.paypal?.mode || 'sandbox',
    },
    verification: d.verification ? { provider: d.verification.provider || null, mode: d.verification.mode || null, status: d.verification.status || null, at: d.verification.at || null, message: d.verification.message || '' } : null,
    updatedBy: d.updatedBy || null,
    updatedAt: d.updatedAt || null,
    paymentsEnabled: Boolean(
      (d.activeProvider === 'razorpay' && d.razorpay?.enabled && d.razorpay?.keyId && d.razorpay?.keySecretEnc)
      || (d.activeProvider === 'paypal' && d.paypal?.enabled && d.paypal?.clientId && d.paypal?.clientSecretEnc)
    ),
  };
}

export async function getPaymentConfig() {
  let doc = await PaymentProviderConfig.findById('default');
  if (!doc) doc = await PaymentProviderConfig.create({ _id: 'default' });
  return doc;
}

export async function getPaymentConfigPublic() {
  return publicView(await getPaymentConfig());
}

/** Build a live provider instance from stored config (or null). */
export async function buildProviderFromConfig(doc) {
  const d = doc || await getPaymentConfig();
  if (d.activeProvider === 'razorpay' && d.razorpay?.enabled && d.razorpay.keyId && d.razorpay.keySecretEnc) {
    return createRazorpayProvider({
      keyId: d.razorpay.keyId,
      keySecret: decryptSecret(d.razorpay.keySecretEnc),
      webhookSecret: d.razorpay.webhookSecretEnc ? decryptSecret(d.razorpay.webhookSecretEnc) : '',
      mode: d.razorpay.mode || 'test',
    });
  }
  if (d.activeProvider === 'paypal' && d.paypal?.enabled && d.paypal.clientId && d.paypal.clientSecretEnc) {
    return createPaypalProvider({
      clientId: d.paypal.clientId,
      clientSecret: decryptSecret(d.paypal.clientSecretEnc),
      webhookId: d.paypal.webhookId || '',
      mode: d.paypal.mode || 'sandbox',
    });
  }
  return null;
}

export async function refreshPaymentProvider() {
  const doc = await getPaymentConfig();
  const provider = await buildProviderFromConfig(doc);
  setPaymentProvider(provider);
  return publicView(doc);
}

export async function updatePaymentConfig(body, { updatedBy } = {}) {
  const doc = await getPaymentConfig();
  const b = body || {};
  if (b.activeProvider && ['none', 'razorpay', 'paypal'].includes(b.activeProvider)) {
    doc.activeProvider = b.activeProvider;
  }
  if (b.razorpay && typeof b.razorpay === 'object') {
    const r = b.razorpay;
    if (typeof r.enabled === 'boolean') doc.razorpay.enabled = r.enabled;
    if (typeof r.keyId === 'string') doc.razorpay.keyId = r.keyId.trim();
    if (typeof r.mode === 'string' && ['test', 'live'].includes(r.mode)) doc.razorpay.mode = r.mode;
    if (typeof r.keySecret === 'string' && r.keySecret.trim() && !r.keySecret.includes('•')) {
      doc.razorpay.keySecretEnc = encryptSecret(r.keySecret.trim());
    }
    if (typeof r.webhookSecret === 'string' && r.webhookSecret.trim() && !r.webhookSecret.includes('•')) {
      doc.razorpay.webhookSecretEnc = encryptSecret(r.webhookSecret.trim());
    }
  }
  if (b.paypal && typeof b.paypal === 'object') {
    const p = b.paypal;
    if (typeof p.enabled === 'boolean') doc.paypal.enabled = p.enabled;
    if (typeof p.clientId === 'string') doc.paypal.clientId = p.clientId.trim();
    if (typeof p.webhookId === 'string') doc.paypal.webhookId = p.webhookId.trim();
    if (typeof p.mode === 'string' && ['sandbox', 'live'].includes(p.mode)) doc.paypal.mode = p.mode;
    if (typeof p.clientSecret === 'string' && p.clientSecret.trim() && !p.clientSecret.includes('•')) {
      doc.paypal.clientSecretEnc = encryptSecret(p.clientSecret.trim());
    }
  }
  doc.verification = { provider: doc.activeProvider, status: 'not_tested', message: 'Configuration saved. Provider response has not been tested.', at: null };
  doc.updatedBy = updatedBy || null;
  doc.updatedAt = new Date();
  await doc.save();
  await refreshPaymentProvider();
  return publicView(doc);
}

export { publicView, maskSecret };

export async function testPaymentConnection() {
  const config = await getPaymentConfig();
  await refreshPaymentProvider();
  const provider = paymentProvider();
  if (!provider) throw Object.assign(new Error('No active provider is configured'), { status: 400, code: 'payments_not_configured' });
  if (typeof provider.testConnection !== 'function') throw Object.assign(new Error('This provider cannot be tested yet. Configuration is saved, not verified.'), { status: 501, code: 'provider_test_unavailable' });
  try {
    await provider.testConnection();
    config.verification = { provider: provider.name, mode: provider.mode, status: 'verified', at: new Date(), message: 'Provider accepted the configured credentials. No payment was created or charged.' };
  } catch (e) {
    config.verification = { provider: provider.name, mode: provider.mode, status: 'failed', at: new Date(), message: String(e.message || 'Provider verification failed').slice(0, 250) };
    await config.save();
    throw Object.assign(new Error(`Provider verification failed: ${config.verification.message}`), { status: e.status === 400 ? 400 : 502, code: 'provider_verification_failed' });
  }
  await config.save();
  return publicView(config);
}
