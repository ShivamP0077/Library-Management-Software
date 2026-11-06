/**
 * Bounded fetch helper. Every attempt has an AbortController timeout, so a sleeping/unreachable
 * backend can never leave a button spinning forever. Retries are capped and use a short
 * exponential backoff. Only use retries for idempotent requests (GET, or writes carrying a
 * client-generated idempotency key).
 */
export class RequestError extends Error {
  constructor(message, { status, code, details, cause, timeout = false } = {}) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.timeout = timeout;
    if (cause) this.cause = cause;
  }
}

const RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
const RETRY_CODES = ['NOTICE_IN_FLIGHT', 'MESSAGE_CONFLICT', 'TICKET_NUMBER_CONFLICT'];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function requestWithRetry(url, {
  retries = 0,
  timeoutMs = 20000,
  retryDelayMs = 500,
  maxRetryDelayMs = 4000,
  retryStatuses = RETRY_STATUSES,
  retryCodes = RETRY_CODES,
  signal,
  fetchImpl = globalThis.fetch,
  ...init
} = {}) {
  if (typeof fetchImpl !== 'function') throw new RequestError('This browser cannot make network requests.');
  let lastError;
  const maxAttempts = Math.max(1, Number(retries) + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Request timeout')); }, Math.max(1000, Number(timeoutMs) || 20000));
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if (attempt < maxAttempts) {
        let shouldRetry = retryStatuses.includes(res.status);
        if (!shouldRetry && retryCodes.length && (res.status === 409 || res.status >= 400)) {
          try {
            const data = await res.clone().json();
            shouldRetry = Boolean(data?.code && retryCodes.includes(data.code));
          } catch { /* not JSON: no code-based retry */ }
        }
        if (shouldRetry) {
          await sleep(Math.min(maxRetryDelayMs, retryDelayMs * (2 ** (attempt - 1))));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      // A caller-cancelled request must stop immediately; our own timeout may retry.
      if (signal?.aborted && !timedOut) throw err;
      if (attempt >= maxAttempts) break;
      await sleep(Math.min(maxRetryDelayMs, retryDelayMs * (2 ** (attempt - 1))));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  const timeout = Boolean(lastError && (lastError.name === 'AbortError' || /timeout|aborted/i.test(lastError.message || '')));
  throw new RequestError(
    timeout
      ? 'The server took too long to respond. Check your connection and retry.'
      : 'Could not reach the server. Check your connection and retry.',
    { cause: lastError, timeout }
  );
}
