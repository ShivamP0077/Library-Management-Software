/**
 * Shared bounded attachment validation/upload client (Issues #3 and #22).
 * Used by admission documents, the student profile and notices.
 *
 * - Validates type/size before reading anything.
 * - Reads with a finite timeout, uploads with finite timeout + bounded retries.
 * - Retries reuse the same storage key, so a timed-out attempt that actually
 *   reached the server is never duplicated.
 * - Progress is reported per file (0..100) for the individual item UI.
 */
import {
  DEFAULT_TIMEOUT_MS,
  nextBackoffDelay,
  isRetryableRequestError,
  friendlyRequestError,
  withTimeout,
} from './boundedRequest.js';

export const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 8;
export const DEFAULT_UPLOAD_RETRIES = 2;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 30000;

const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

export const extensionOf = (name) => String(name || '').split('.').pop().toLowerCase();

/** Browsers sometimes leave File.type empty (notably Android camera/files); infer from the extension. */
export function mimeOf(file) {
  const type = String(file?.type || '').toLowerCase().split(';')[0];
  if (type) return type;
  return EXT_TYPE[extensionOf(file?.name)] || '';
}

export function isPdfAttachment(file) {
  return mimeOf(file) === 'application/pdf' || extensionOf(file?.name) === 'pdf';
}

/** Validate one picked file. Returns { ok, error, code, name, type, size }. */
export function validateAttachment(file, {
  allowedTypes = DEFAULT_ALLOWED_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!file) return { ok: false, code: 'missing', error: 'Choose a file first.' };
  const name = String(file.name || 'file');
  const type = mimeOf(file);
  const size = Number(file.size || 0);
  if (!allowedTypes.includes(type)) {
    return { ok: false, code: 'type', error: `${name}: only JPG, PNG, WEBP or PDF files are allowed.`, name, type, size };
  }
  if (size > maxBytes) {
    const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    return { ok: false, code: 'size', error: `${name} is larger than ${mb} MB.`, name, type, size };
  }
  if (size <= 0) return { ok: false, code: 'empty', error: `${name} is empty.`, name, type, size };
  return { ok: true, name, type, size };
}

/** Stable key for an upload. Reusing `id` makes retries idempotent. */
export function makeAttachmentKey(prefix = 'att', id) {
  if (id != null && String(id).trim()) {
    return `${prefix}_${String(id).trim().replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Read a File into a data URL with a finite timeout. */
export function readFileAsDataUrl(file, {
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
  FileReaderImpl = typeof FileReader !== 'undefined' ? FileReader : null,
} = {}) {
  if (!FileReaderImpl) return Promise.reject(Object.assign(new Error('This browser cannot read files.'), { code: 'unsupported' }));
  const read = new Promise((resolve, reject) => {
    const reader = new FileReaderImpl();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Object.assign(new Error('Could not read this file.'), { code: 'read_error' }));
    reader.readAsDataURL(file);
  });
  return withTimeout(read, timeoutMs, 'Reading this file took too long. Please try again.');
}

/**
 * Upload an already-read data URL. `save(key, data)` must persist idempotently by key.
 * Retries are bounded and use jittered exponential backoff, honouring err.retryAfterMs.
 */
export async function uploadAttachmentData({
  key,
  data,
  save,
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
  retries = DEFAULT_UPLOAD_RETRIES,
  onProgress = () => {},
  random = Math.random,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!key) throw Object.assign(new Error('Missing attachment key'), { code: 'missing_key' });
  if (!data) throw Object.assign(new Error('Missing attachment data'), { code: 'missing_data' });
  if (typeof save !== 'function') throw Object.assign(new Error('Missing upload function'), { code: 'missing_save' });
  const attempts = Math.max(0, Number(retries) || 0);
  let lastErr;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      onProgress(Math.min(90, 15 + attempt * 15), 'uploading');
      await withTimeout(save(key, data), timeoutMs, 'Upload took too long. Please try again.');
      onProgress(100, 'uploaded');
      return { key, ok: true };
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryableRequestError(err)) break;
      onProgress(Math.min(90, 20 + attempt * 15), 'retrying');
      await sleep(nextBackoffDelay(attempt, { random, retryAfterMs: err?.retryAfterMs }));
    }
  }
  const error = friendlyRequestError(lastErr, 'Could not upload the file. Please try again.');
  throw Object.assign(new Error(error), { code: 'upload_failed', status: lastErr?.status, cause: lastErr });
}

/** Validate + read + upload one file. Returns metadata suitable for a documents/attachments array. */
export async function uploadAttachmentFile({
  file,
  key = makeAttachmentKey(),
  save,
  allowedTypes = DEFAULT_ALLOWED_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
  retries = DEFAULT_UPLOAD_RETRIES,
  onProgress = () => {},
  FileReaderImpl,
  random,
  sleep,
  returnDataUrl = false,
} = {}) {
  const check = validateAttachment(file, { allowedTypes, maxBytes });
  if (!check.ok) throw Object.assign(new Error(check.error), { code: check.code });
  onProgress(5, 'reading');
  const dataUrl = await readFileAsDataUrl(file, { timeoutMs, FileReaderImpl });
  onProgress(10, 'read');
  await uploadAttachmentData({ key, data: dataUrl, save, timeoutMs, retries, onProgress, random, sleep });
  return {
    id: key,
    storageKey: key,
    name: check.name,
    fileName: check.name,
    fileType: check.type,
    fileSize: check.size,
    uploadedAt: new Date().toISOString(),
    ...(returnDataUrl ? { dataUrl } : {}),
  };
}

/** Prepare a file for an inline (data URL) request such as a notice attachment. */
export async function prepareAttachment({
  file,
  key = makeAttachmentKey('notice'),
  allowedTypes = DEFAULT_ALLOWED_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
  onProgress = () => {},
  FileReaderImpl,
} = {}) {
  const check = validateAttachment(file, { allowedTypes, maxBytes });
  if (!check.ok) throw Object.assign(new Error(check.error), { code: check.code });
  onProgress(10, 'reading');
  const dataUrl = await readFileAsDataUrl(file, { timeoutMs, FileReaderImpl });
  onProgress(100, 'ready');
  return {
    id: key,
    key,
    name: check.name,
    fileName: check.name,
    fileType: check.type,
    fileSize: check.size,
    dataUrl,
    uploadedAt: new Date().toISOString(),
  };
}
