import crypto from 'crypto';
/**
 * Minimal Evolution API (v2) client. Server-side only: the API key never leaves the backend.
 * Env: EVOLUTION_API_URL, EVOLUTION_API_KEY. `fetchImpl` is injectable for tests.
 */
export class EvolutionError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export const evolutionConfigured = (env = process.env) => Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY);

/** Evolution instance used by My Library OS itself (sign-up codes). Never a library. */
export const SYSTEM_INSTANCE = 'libos-system';

/** One Evolution instance per library: deterministic, URL-safe, derived from libraryId. Never the system instance. */
export const instanceNameFor = (libraryId) => {
  const slug = String(libraryId || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (!slug) throw new EvolutionError('Invalid libraryId', 400);
  const name = `libos-${slug}`;
  if (name === SYSTEM_INSTANCE) throw new EvolutionError('That library id is reserved', 400);
  return name;
};

/** Per-instance webhook secret derived from EVOLUTION_API_KEY (no extra env var needed). */
export const webhookTokenFor = (instance, key = process.env.EVOLUTION_API_KEY) =>
  key ? crypto.createHmac('sha256', String(key)).update(`libos-webhook:${instance}`).digest('hex').slice(0, 40) : null;

/** Digits only, with an Indian (+91) default for bare 10-digit numbers. */
export const normalizePhone = (raw, defaultCountry = '91') => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = defaultCountry + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
};

/** Short, human-readable reason from an Evolution error response (never includes secrets). */
/** True when a body is an HTML page (e.g. a proxy/edge "429 Too Many Requests" page). */
export const looksLikeHtml = (v) => typeof v === 'string' && /<\s*(!doctype|html|head|body|style|script|div|title)\b/i.test(v);

/** Short, human-readable reason from an Evolution error response (never includes secrets or raw HTML/CSS). */
export function upstreamReason(status, data) {
  const pick = (v) => Array.isArray(v) ? v.map(pick).filter(Boolean).join('; ') : v && typeof v === 'object' ? pick(v.message ?? v.error ?? (v.exists === false ? `number ${v.number || ''} is not on WhatsApp` : "")) : v ? String(v) : '';
  let msg = pick(data?.response?.message ?? data?.message ?? data?.error ?? data?.raw);
  if (looksLikeHtml(msg)) msg = '';
  if (!msg && status === 429) msg = 'service is busy or still starting up';
  if (!msg && [502, 503, 504].includes(status)) msg = 'service is starting up';
  msg = String(msg || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `HTTP ${status}${msg ? ': ' + msg : ''}`;
}

/** Hard cap so a caller cannot pass an unbounded wake/connect timeout. */
export const WAKE_TIMEOUT_CAP_MS = 90000;

const breakerFailure = (err) => {
  if (err?.code === 'circuit_open') return false;
  const up = err?.upstreamStatus;
  if (up != null) return up >= 500;
  return err?.status === 503;
};

/**
 * After a short streak of timeouts or 5xx, open and fail fast, then allow one probe.
 * 4xx (including 404 and 429) does not open the breaker.
 */
export function createCircuitBreaker({ failureThreshold = 3, openMs = 30000, now = () => Date.now() } = {}) {
  let state = 'closed';
  let failures = 0;
  let openedAt = 0;
  return {
    snapshot: () => ({ state, failures, openedAt, failureThreshold, openMs }),
    beforeCall() {
      if (state !== 'open') return;
      if (now() - openedAt >= openMs) { state = 'half_open'; return; }
      const err = new EvolutionError('WhatsApp is temporarily unavailable', 503);
      err.code = 'circuit_open';
      throw err;
    },
    success() { state = 'closed'; failures = 0; openedAt = 0; },
    failure(err) {
      if (!breakerFailure(err)) {
        if (state === 'half_open') this.success();
        return;
      }
      failures += 1;
      if (state === 'half_open' || failures >= failureThreshold) {
        state = 'open';
        openedAt = now();
      }
    },
  };
}

export function createEvolutionClient({
  baseUrl = process.env.EVOLUTION_API_URL,
  apiKey = process.env.EVOLUTION_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  breaker = createCircuitBreaker({
    failureThreshold: Number(process.env.WHATSAPP_CB_THRESHOLD || 3),
    openMs: Number(process.env.WHATSAPP_CB_OPEN_MS || 30000),
  }),
} = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  async function call(method, path, body, callTimeoutMs = timeoutMs) {
    if (!base || !apiKey) throw new EvolutionError('WhatsApp integration is not configured on the server', 503);
    const ms = Math.min(WAKE_TIMEOUT_CAP_MS, Math.max(1, Number(callTimeoutMs) || timeoutMs));
    breaker.beforeCall();
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      const err = new EvolutionError(timedOut
        ? 'WhatsApp service timed out. It may be waking up; try again in a minute.'
        : 'WhatsApp service is unreachable. It may be waking up; try again in a minute.', 503);
      breaker.failure(err);
      throw err;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const reason = upstreamReason(res.status, data);
      const busy = [429, 502, 503, 504].includes(res.status);
      const err = new EvolutionError(res.status === 404 ? 'WhatsApp instance not found'
        : busy ? 'WhatsApp service is starting up. Please try again in a minute.'
        : `WhatsApp service request failed (${reason})`, res.status === 404 ? 404 : busy ? 503 : 502);
      err.upstreamStatus = res.status;
      err.upstreamBody = data;
      const retryAfter = Number(res.headers?.get?.('retry-after') || 0);
      if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = Math.min(retryAfter * 1000, 60000);
      breaker.failure(err);
      throw err;
    }
    breaker.success();
    return data;
  }
  const enc = encodeURIComponent;
  return {
    async findInstance(name) {
      const list = await call('GET', `/instance/fetchInstances?instanceName=${enc(name)}`).catch(e => { if (e.status === 404) return []; throw e; });
      const arr = Array.isArray(list) ? list : [];
      return arr.find(i => (i.name || i.instance?.instanceName) === name) || null;
    },
    createInstance: (name) => call('POST', '/instance/create', { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    connect: (name) => call('GET', `/instance/connect/${enc(name)}`),
    connectionState: (name) => call('GET', `/instance/connectionState/${enc(name)}`),
    /** Wake a sleeping (free-plan) Evolution service: same read as connectionState, with a long timeout for the cold start. */
    wake: (name, ms = 60000) => call('GET', `/instance/connectionState/${enc(name)}`, undefined, ms),
    logout: (name) => call('DELETE', `/instance/logout/${enc(name)}`),
    setWebhook: (name, url) => call('POST', `/webhook/set/${enc(name)}`, { webhook: { enabled: true, url, byEvents: false, base64: false, events: ['MESSAGES_UPDATE'] } }),
    sendText: (name, number, text) => call('POST', `/message/sendText/${enc(name)}`, { number, text }),
    /** Shared by every method above, including ones added later (logout/delete, media). */
    circuitSnapshot: () => breaker.snapshot(),
  };
}
