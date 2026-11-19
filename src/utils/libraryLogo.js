/** Detect whether a stored logo/QR value can be rendered as an image. */
export function libraryLogoUrl(logo) {
  const value = typeof logo === 'string' ? logo.trim() : '';
  if (!value) return '';
  if (/^(https?:\/\/|data:image\/)/i.test(value)) return value;
  if (value.startsWith('/') && /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(value)) return value;
  return '';
}

export const DEFAULT_LIBRARY_LOGO = '📖';

export const BRAND_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

export function isAllowedBrandImageType(type, fileName = '') {
  const mime = String(type || '').toLowerCase();
  if (BRAND_IMAGE_TYPES.includes(mime)) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(String(fileName || ''));
}
