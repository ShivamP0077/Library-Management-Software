/** Public support contact shown in the app. Override with VITE_SUPPORT_EMAIL. */
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'mylibraryosadmin@gmail.com';
export const PAYMENT_NOT_READY_MESSAGE = `Online payment is not set up yet. Please contact support at ${SUPPORT_EMAIL}.`;
export const SUPPORT_PHONE = String(import.meta.env.VITE_SUPPORT_PHONE || '').trim();
/** Dedicated support WhatsApp only. Never a library owner's mobile. */
export const SUPPORT_WHATSAPP = String(import.meta.env.VITE_SUPPORT_WHATSAPP || '').trim();

export const LEGAL_SITE = String(import.meta.env.VITE_SITE_URL || 'https://mylibraryos.in').replace(/\/+$/, '');
export const legalHref = (path) => `${LEGAL_SITE}${path.startsWith('/') ? path : `/${path}`}`;

export const whatsappHref = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
};
