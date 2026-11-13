/**
 * Backend API client.
 * - Production (e.g. Vercel): set VITE_API_URL to the backend origin, e.g. https://lms-api.onrender.com
 * - Local dev: leave it unset; requests go to /api and Vite proxies them to the local server.
 */
const RAW_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const API_BASE = RAW_BASE ? (RAW_BASE.endsWith('/api') ? RAW_BASE : `${RAW_BASE}/api`) : '/api';

import { parseJsonSafe } from './parseJsonSafe';
import { requestWithRetry, RequestError } from './request';
export { parseJsonSafe, requestWithRetry, RequestError };

const idemKey = () => globalThis.crypto?.randomUUID?.() || `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TOKEN_KEY = 'library_api_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Tenant context used by super admin drill-in (client admins are scoped server-side by their token)
let tenantContext = { libraryId: null, readOnly: false };
export const setTenantContext = (ctx) => { tenantContext = { libraryId: null, readOnly: false, ...ctx }; };
export const getTenantContext = () => tenantContext;

let unauthorizedHandler = null;
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

export async function apiRequest(path, { method = 'GET', body, signal, retries = 0, timeoutMs = 20000, headers: extraHeaders } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantContext.libraryId) headers['X-Library-Id'] = tenantContext.libraryId;
  if (tenantContext.readOnly) headers['X-Read-Only'] = '1';
  const res = await requestWithRetry(`${API_BASE}${path}`, {
    method, headers, signal, retries, timeoutMs,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = parseJsonSafe(text, res.status);
  if (res.status === 401 && token && unauthorizedHandler) unauthorizedHandler();
  if (res.status === 402 && data?.code === 'SUBSCRIPTION_LOCKED' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('libos:subscription-locked', { detail: data }));
  }
  if (!res.ok) {
    const message = data?.code === 'SUBSCRIPTION_LOCKED'
      ? (data.message || 'Your plan has expired.')
      : (data?.error || `Request failed (${res.status})`);
    throw Object.assign(new Error(message), { status: res.status, code: data?.code, details: data?.details, retryAfterMs: Number(res.headers.get('retry-after') || 0) * 1000 || undefined });
  }
  return data;
}

/** Download an authenticated file (CSV etc.) from the API and save it in the browser. */
export async function downloadFile(path, fallbackName = 'export.csv') {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantContext.libraryId) headers['X-Library-Id'] = tenantContext.libraryId;
  if (tenantContext.readOnly) headers['X-Read-Only'] = '1';
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) { let msg = `Download failed (${res.status})`; try { msg = (await res.json()).error || msg; } catch { /* not json */ } throw new Error(msg); }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  health: () => apiRequest('/health'),
  getState: () => apiRequest('/state'),
  saveSettings: (settings) => apiRequest('/settings', { method: 'PUT', body: settings }),
  syncCollection: (col, items) => apiRequest(`/${col}`, { method: 'PUT', body: items }),
  authConfig: () => apiRequest('/auth/config'),
  googleStartUrl: () => `${API_BASE}/auth/google/start`,
  login: async (credentials) => { const r = await apiRequest('/auth/login', { method: 'POST', body: credentials }); setToken(r.token); return r; },
  loginWithGoogle: async (credential) => { const r = await apiRequest('/auth/google', { method: 'POST', body: { credential } }); setToken(r.token); return r; },
  me: () => apiRequest('/auth/me'),
  logout: () => setToken(null),
  // WhatsApp (finite client timeouts; the server also wakes/retries within a budget)
  whatsappStatus: (timeoutMs = 15000) => apiRequest('/whatsapp/status', { timeoutMs }),
  whatsappConnect: (timeoutMs = 45000) => apiRequest('/whatsapp/connect', { method: 'POST', timeoutMs }),
  whatsappLogout: (timeoutMs = 20000) => apiRequest('/whatsapp/logout', { method: 'POST', timeoutMs }),
  whatsappSaveSettings: (body) => apiRequest('/whatsapp/settings', { method: 'PUT', body }),
  reminderSettings: () => apiRequest('/reminders/settings'),
  saveReminderSettings: (body) => apiRequest('/reminders/settings', { method: 'PUT', body }),
  reminders: (q = '') => apiRequest(`/reminders${q}`),
  whatsappTemplates: () => apiRequest('/whatsapp-templates'),
  saveWhatsappTemplates: (body) => apiRequest('/whatsapp-templates', { method: 'PUT', body }),
  whatsappMessages: (q = '') => apiRequest(`/whatsapp/messages${q}`),
  whatsappResend: (id) => apiRequest(`/whatsapp/messages/${encodeURIComponent(id)}/resend`, { method: 'POST' }),
  whatsappSendToStudent: (studentId, body) => apiRequest(`/whatsapp/students/${encodeURIComponent(studentId)}/send`, { method: 'POST', body }),
  whatsappSendReceipt: (receiptNo, type) => apiRequest(`/whatsapp/receipts/${encodeURIComponent(receiptNo)}`, { method: 'POST', body: { type } }),
  // Seats (server-side atomic allocation)
  seatAllocations: (params = '') => apiRequest(`/seat-allocations${params}`),
  assignSeat: (body) => apiRequest('/seat-allocations/assign', { method: 'POST', body }),
  setSeatMaintenance: (seatId, isMaintenance) => apiRequest(`/seats/${encodeURIComponent(seatId)}/maintenance`, { method: 'PATCH', body: { isMaintenance } }),
  // Accounts
  forgotPassword: (email) => apiRequest('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (email, otp, newPassword) => apiRequest('/auth/reset-password', { method: 'POST', body: { email, otp, newPassword } }),
  forgotPasswordMobile: (mobile) => apiRequest('/auth/forgot-password-mobile', { method: 'POST', body: { mobile } }),
  resetPasswordMobile: (mobile, otp, newPassword) => apiRequest('/auth/reset-password-mobile', { method: 'POST', body: { mobile, otp, newPassword } }),
  inviteInfo: (token) => apiRequest(`/auth/invite/${encodeURIComponent(token)}`),
  signupConfig: () => apiRequest('/auth/signup/config'),
  signupStart: (email) => apiRequest('/auth/signup/start', { method: 'POST', body: { email } }),
  signupStartMobile: (mobile) => apiRequest('/auth/signup/start-mobile', { method: 'POST', body: { mobile } }),
  signupComplete: async (body) => { const r = await apiRequest('/auth/signup/complete', { method: 'POST', body }); setToken(r.token); return r; },
  signupCompleteMobile: async (body) => { const r = await apiRequest('/auth/signup/complete-mobile', { method: 'POST', body }); setToken(r.token); return r; },
  signupCompleteGoogle: async (body) => { const r = await apiRequest('/auth/signup/complete-google', { method: 'POST', body }); setToken(r.token); return r; },
  subscriptionCheckout: (returnUrl) => apiRequest('/subscription/checkout', { method: 'POST', body: { returnUrl } }),
  profile: () => apiRequest('/account/profile'),
  updateProfile: (body) => apiRequest('/account/profile', { method: 'PATCH', body }),
  registrationConfirmation: () => apiRequest('/account/registration-confirmation'),
  retryRegistrationConfirmation: () => apiRequest('/account/registration-confirmation/retry', { method: 'POST', body: {} }),
  downloadRegistrationConfirmation: (format = 'txt') => downloadFile(`/account/registration-confirmation/download${format === 'pdf' ? '?format=pdf' : ''}`, `registration-confirmation.${format === 'pdf' ? 'pdf' : 'txt'}`),
  registrationConfirmationHistory: () => apiRequest('/account/registration-confirmation/history'),
  reauthStart: (via) => apiRequest('/account/reauth/start', { method: 'POST', body: { via } }),
  reauthComplete: (code) => apiRequest('/account/reauth/complete', { method: 'POST', body: { code } }),
  contactStart: (body) => apiRequest('/account/contact/start', { method: 'POST', body }),
  contactVerify: (body) => apiRequest('/account/contact/verify', { method: 'POST', body }),
  contactUnlink: (body) => apiRequest('/account/contact/unlink', { method: 'POST', body }),
  setupPasswordStart: (via) => apiRequest('/account/password/setup/start', { method: 'POST', body: { via } }),
  setupPasswordComplete: (code, newPassword) => apiRequest('/account/password/setup/complete', { method: 'POST', body: { code, newPassword } }),
  softwarePlan: () => apiRequest('/software-plan'),
  softwarePlanQuote: (body) => apiRequest('/software-plan/quote', { method: 'POST', body }),
  softwarePlanCheckout: (body, key) => apiRequest('/software-plan/checkout', { method: 'POST', body, headers: { 'Idempotency-Key': key || idemKey() } }),
  softwarePlanInvoices: () => apiRequest('/software-plan/invoices'),
  softwarePlanReceipt: (invoiceId, format = 'pdf') => downloadFile(`/software-plan/invoices/${encodeURIComponent(invoiceId)}/receipt?format=${format}`, `receipt-${invoiceId}.${format}`),
  softwarePlanDeliverReceipt: (invoiceId) => apiRequest(`/software-plan/invoices/${encodeURIComponent(invoiceId)}/receipt/deliver`, { method: 'POST', body: {} }),
  wallet: () => apiRequest('/software-plan/wallet'),
  walletHistory: (limit = 100) => apiRequest(`/software-plan/wallet/history?limit=${encodeURIComponent(limit)}`),
  walletTopup: (body, key) => apiRequest('/software-plan/wallet/topups', { method: 'POST', body, headers: { 'Idempotency-Key': key || idemKey() } }),
  referrals: () => apiRequest('/software-plan/referrals'),
  adminBillingConfig: () => apiRequest('/admin/billing/config'),
  adminUpdateBillingConfig: (body) => apiRequest('/admin/billing/config', { method: 'PUT', body }),
  adminOffers: () => apiRequest('/admin/offers'),
  adminCreateOffer: (body) => apiRequest('/admin/offers', { method: 'POST', body }),
  adminUpdateOffer: (offerId, body) => apiRequest(`/admin/offers/${encodeURIComponent(offerId)}`, { method: 'PUT', body }),
  adminReferralCampaigns: () => apiRequest('/admin/referral-campaigns'),
  adminCreateReferralCampaign: (body) => apiRequest('/admin/referral-campaigns', { method: 'POST', body }),
  adminPaymentsConfig: () => apiRequest('/admin/payments/config'),
  adminUpdatePaymentsConfig: (body) => apiRequest('/admin/payments/config', { method: 'PUT', body }),
  adminTestPaymentsConfig: () => apiRequest('/admin/payments/config/test', { method: 'POST', body: {} }),
  adminDeletionRequests: () => apiRequest('/admin/payments/deletion-requests'),
  adminResolveDeletionRequest: (libraryId, action) => apiRequest(`/admin/payments/deletion-requests/${libraryId}/resolve`, { method: 'POST', body: { action } }),
  acceptInvite: async (body) => { const r = await apiRequest('/auth/invite/accept', { method: 'POST', body }); setToken(r.token); return r; },
  invites: () => apiRequest('/invites'),
  createInvite: (body) => apiRequest('/invites', { method: 'POST', body }),
  revokeInvite: (id) => apiRequest(`/invites/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  auditLogs: (q = '') => apiRequest(`/audit-logs${q}`),
  // Notifications
  notifications: (q = '') => apiRequest(`/notifications${q}`),
  notificationCounts: () => apiRequest('/notifications/unread-count'),
  markNotificationRead: (id, unread = false) => apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: { unread } }),
  markAllNotificationsRead: () => apiRequest('/notifications/read-all', { method: 'POST' }),
  resolveNotification: (id, resolution) => apiRequest(`/notifications/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { resolution } }),
  notificationAttachment: (id) => apiRequest(`/notifications/${encodeURIComponent(id)}/attachment`),
  notificationAttachments: (id, attachmentId) => apiRequest(`/notifications/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`),
  refreshNotifications: () => apiRequest('/notifications/refresh', { method: 'POST' }),
  createNotice: (notice, opts = {}) => apiRequest('/notices', { method: 'POST', body: notice, retries: opts.retries ?? 2, timeoutMs: opts.timeoutMs }),
  supportMeta: () => apiRequest('/support/meta'),
  tickets: (q = '') => apiRequest(`/support/tickets${q}`),
  ticket: (id) => apiRequest(`/support/tickets/${id}`),
  createTicket: (b, opts = {}) => apiRequest('/support/tickets', { method: 'POST', body: b, retries: opts.retries ?? 2, timeoutMs: opts.timeoutMs }),
  replyTicket: (id, b, opts = {}) => apiRequest(`/support/tickets/${id}/messages`, { method: 'POST', body: b, retries: opts.retries ?? 2, timeoutMs: opts.timeoutMs }),
  updateTicket: (id, b) => apiRequest(`/support/tickets/${id}`, { method: 'PATCH', body: b }),
  ticketAttachment: (id, m, a) => apiRequest(`/support/tickets/${id}/messages/${m}/attachments/${a}`),
  adminTickets: (q = '') => apiRequest(`/admin/support/tickets${q}`),
  adminTicket: (id) => apiRequest(`/admin/support/tickets/${id}`),
  adminReplyTicket: (id, b, opts = {}) => apiRequest(`/admin/support/tickets/${id}/messages`, { method: 'POST', body: b, retries: opts.retries ?? 2, timeoutMs: opts.timeoutMs }),
  adminUpdateTicket: (id, b) => apiRequest(`/admin/support/tickets/${id}`, { method: 'PATCH', body: b }),
  adminInternalNote: (id, b) => apiRequest(`/admin/support/tickets/${id}/internal-notes`, { method: 'POST', body: b }),
  adminTicketAttachment: (id, m, a) => apiRequest(`/admin/support/tickets/${id}/messages/${m}/attachments/${a}`),
  uploadNotice: (body, opts = {}) => apiRequest('/notices', { method: 'POST', body, retries: opts.retries ?? 2, timeoutMs: opts.timeoutMs }),
  // Students
  studentsSummary: (branchId = 'all') => apiRequest(`/students-summary?branchId=${encodeURIComponent(branchId)}`),
  studentHistory: (id) => apiRequest(`/students/${encodeURIComponent(id)}/history`),
  deleteArchivedStudent: (id, reason) => apiRequest(`/archived-students/${encodeURIComponent(id)}`, { method: 'DELETE', body: { confirm: id, reason } }),
  // Finance
  feeSuggest: (base, tiers) => apiRequest(`/fees/suggest?base=${encodeURIComponent(base)}&tiers=${encodeURIComponent(tiers)}`),
  recurringExpenses: () => apiRequest('/recurring-expenses'),
  createRecurringExpense: (body) => apiRequest('/recurring-expenses', { method: 'POST', body }),
  updateRecurringExpense: (id, body) => apiRequest(`/recurring-expenses/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  stopRecurringExpense: (id) => apiRequest(`/recurring-expenses/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  expenseInstances: (q = '') => apiRequest(`/expense-instances${q}`),
  updateExpenseInstance: (id, body) => apiRequest(`/expense-instances/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  payExpenseInstance: (id, body) => apiRequest(`/expense-instances/${encodeURIComponent(id)}/payments`, { method: 'POST', body }),
  pnl: (q = '') => apiRequest(`/reports/pnl${q}`),
  downloadCsv: async (path, filename) => {
    const headers = {}; const t = getToken(); if (t) headers.Authorization = `Bearer ${t}`;
    if (tenantContext.libraryId) headers['X-Library-Id'] = tenantContext.libraryId;
    const res = await fetch(`${API_BASE}${path}`, { headers });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  },
  // Super admin
  adminLibraries: () => apiRequest('/admin/libraries'),
  adminPlans: () => apiRequest('/admin/plans'),
  adminList: (part) => apiRequest(`/admin${part}`),
  adminCreatePlan: (body) => apiRequest('/admin/plans', { method: 'POST', body }),
  adminUpdatePlan: (planId, body) => apiRequest(`/admin/plans/${encodeURIComponent(planId)}`, { method: 'PATCH', body }),
  adminMetrics: () => apiRequest('/admin/metrics'),
  adminSaasSummary: () => apiRequest('/admin/saas-summary'),
  adminInsights: (q = '') => apiRequest(`/admin/insights${q}`),
  adminCreateLibrary: (body) => apiRequest('/admin/libraries', { method: 'POST', body }),
  adminPartners: () => apiRequest('/admin/partners'),
  adminCreatePartner: (body) => apiRequest('/admin/partners', { method: 'POST', body }),
  adminUpdatePartner: (id, body) => apiRequest(`/admin/partners/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  adminSetCommissionRule: (id, appliesTo, body) => apiRequest(`/admin/partners/${encodeURIComponent(id)}/rules/${appliesTo}`, { method: 'PUT', body }),
  adminAssignLibrary: (libraryId, body) => apiRequest(`/admin/libraries/${encodeURIComponent(libraryId)}/assign`, { method: 'POST', body }),
  adminRecordSale: (body) => apiRequest('/admin/sales', { method: 'POST', body }),
  adminCommissions: (q = '') => apiRequest(`/admin/commissions${q}`),
  adminReverseCommission: (id, body) => apiRequest(`/admin/commissions/${encodeURIComponent(id)}/reverse`, { method: 'POST', body }),
  partnerMe: () => apiRequest('/partner/me'),
  partnerLibraries: () => apiRequest('/partner/libraries'),
  partnerCommissions: () => apiRequest('/partner/commissions'),
  changePassword: (currentPassword, newPassword) => apiRequest('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  adminUpdateLibrary: (libraryId, body) => apiRequest(`/admin/libraries/${encodeURIComponent(libraryId)}`, { method: 'PATCH', body }),
  subscription: () => apiRequest('/subscription'),
  subscriptionSummary: () => apiRequest('/subscription/summary'),
  subscriptionHistory: () => apiRequest('/subscription/history'),
  subscriptionRenew: (body, key) => apiRequest('/subscription/renew', { method: 'POST', body, headers: { 'Idempotency-Key': key || idemKey() } }),
  subscriptionRenewEarly: (body, key) => apiRequest('/subscription/renew-early', { method: 'POST', body, headers: { 'Idempotency-Key': key || idemKey() } }),
  subscriptionUpgrade: (body, key) => apiRequest('/subscription/upgrade', { method: 'POST', body, headers: { 'Idempotency-Key': key || idemKey() } }),
  dashboardCounts: () => apiRequest('/dashboard'),
  subscriptionChange: (planId, interval) => apiRequest('/subscription/change', { method: 'POST', body: { planId, interval } }),
  subscriptionCancel: (resume) => apiRequest('/subscription/cancel', { method: 'POST', body: { resume: Boolean(resume) } }),
  subscriptionRequestDeletion: (confirmName, reason) => apiRequest('/subscription/deletion-request', { method: 'POST', body: { confirmName, reason } }),
  subscriptionWithdrawDeletion: () => apiRequest('/subscription/deletion-request', { method: 'DELETE' }),
  adminDeleteLibrary: (libraryId, confirmName) => apiRequest(`/admin/libraries/${encodeURIComponent(libraryId)}`, { method: 'DELETE', body: { confirmName } }),
  adminAddLibraryUser: (libraryId, body) => apiRequest(`/admin/libraries/${encodeURIComponent(libraryId)}/users`, { method: 'POST', body }),
  adminUpdateUser: (id, body) => apiRequest(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  saveDocument: (key, data, meta = {}) => apiRequest(`/documents/${encodeURIComponent(key)}`, { method: 'PUT', body: { data, ...meta }, timeoutMs: 30000 }),
  getDocument: (key) => apiRequest(`/documents/${encodeURIComponent(key)}`, { timeoutMs: 30000 }).then(r => r?.data ?? null),
  getStudentDocument: (studentId, key) => apiRequest(`/students/${encodeURIComponent(studentId)}/documents/${encodeURIComponent(key)}`, { timeoutMs: 30000 }).then(r => r?.data ?? null),
  updateDocumentMeta: (key, meta = {}) => apiRequest(`/documents/${encodeURIComponent(key)}`, { method: 'PATCH', body: meta, timeoutMs: 20000 }),
  deleteDocument: (key) => apiRequest(`/documents/${encodeURIComponent(key)}`, { method: 'DELETE', timeoutMs: 20000 }),
};

/** Collections persisted by LibraryContext, mapped to backend collection names. */
export const SYNCED_COLLECTIONS = [
  'branches', 'sections', 'seatTypes', 'seats', 'shifts', 'plans', 'staffMembers',
  'students', 'archivedStudents', 'expenses', 'payments', 'waitingList'
];

/**
 * Debounced, change-detecting sync of one piece of state to the backend.
 * Only runs once the initial load from the backend has completed (enable()).
 */
export function createSyncQueue({ delay = 400, onError } = {}) {
  const last = new Map();
  const timers = new Map();
  let enabled = false;
  const push = async (key, value) => {
    const json = JSON.stringify(value);
    if (last.get(key) === json) return;
    try {
      if (key === 'settings') await api.saveSettings(value);
      else await api.syncCollection(key, value);
      last.set(key, json);
    } catch (e) {
      onError?.(key, e);
    }
  };
  return {
    enable: () => { enabled = true; },
    disable: () => { enabled = false; },
    isEnabled: () => enabled,
    markSynced: (key, value) => last.set(key, JSON.stringify(value)),
    push,
    queue(key, value) {
      if (!enabled) return;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => push(key, value), delay));
    },
  };
}
