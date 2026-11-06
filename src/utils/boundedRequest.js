/**
 * Shared reliability helpers for client requests (Issues #3, #18, #22).
 * Everything here is pure and injectable so it can be unit-tested with node:test.
 */

export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_RETRY_BASE_MS = 700;
export const DEFAULT_RETRY_MAX_MS = 8000;

/** A finite timeout around any promise. `ms <= 0` disables the timeout. */
export function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS, message = 'The request took too long. Please try again.') {
  if (!(Number(ms) > 0)) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = 'timeout';
      err.name = 'TimeoutError';
      reject(err);
    }, Number(ms));
    if (timer?.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/** Bounded exponential backoff with jitter, optionally respecting Retry-After. */
export function nextBackoffDelay(attempt, {
  baseMs = DEFAULT_RETRY_BASE_MS,
  maxMs = DEFAULT_RETRY_MAX_MS,
  jitterRatio = 0.25,
  random = Math.random,
  retryAfterMs,
} = {}) {
  const retry = Number(retryAfterMs);
  if (Number.isFinite(retry) && retry >= 0) return Math.min(Math.max(0, retry), Math.max(0, Number(maxMs) || 0));
  const exp = Math.min(Math.max(0, baseMs) * (2 ** Math.max(0, Number(attempt) || 0)), Math.max(0, maxMs));
  const jitter = Math.floor(exp * Math.max(0, jitterRatio) * Math.max(0, Math.min(1, random())));
  return Math.min(Math.max(0, maxMs), exp + jitter);
}

/** Network failures, timeouts, 408/425/429 and 5xx are worth retrying; 4xx validation errors are not. */
export function isRetryableRequestError(err) {
  if (!err) return false;
  if (err.code === 'timeout' || err.code === 'network' || err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const s = Number(err.status);
  if (!s) return true;
  return s === 408 || s === 425 || s === 429 || s >= 500;
}

const HTML_RE = /<\s*(!doctype|html|head|body|style|script|div|title)\b|\{[^}]*:[^}]*;[^}]*\}/i;

/** Friendly, redacted network/API errors. Never returns raw HTML/CSS. */
export function friendlyRequestError(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.code === 'timeout' || err?.name === 'TimeoutError') return 'The request took too long. Check your connection and try again.';
  const status = Number(err?.status);
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return err?.message || 'You do not have permission to do that.';
  if (status === 413) return 'This file is too large. Choose a smaller file.';
  if (status === 429) return 'The server is busy. Please wait a moment and try again.';
  if (status >= 500) return 'The server is starting up or unavailable. Please try again in a minute.';
  const msg = String(err?.message || '').trim();
  if (!msg || HTML_RE.test(msg) || /Unexpected token|JSON/i.test(msg)) return fallback;
  return msg.slice(0, 200);
}
