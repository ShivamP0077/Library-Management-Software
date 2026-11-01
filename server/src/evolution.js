/**
 * Minimal Evolution API (v2) client. Server-side only: the API key never leaves the backend.
 * Env: EVOLUTION_API_URL, EVOLUTION_API_KEY. `fetchImpl` is injectable for tests.
 */
export class EvolutionError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export const evolutionConfigured = (env = process.env) => Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY);

/** One Evolution instance per library: deterministic, URL-safe, derived from libraryId. */
export const instanceNameFor = (libraryId) => {
  const slug = String(libraryId || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (!slug) throw new EvolutionError('Invalid libraryId', 400);
  return `libos-${slug}`;
};

/** Digits only, with an Indian (+91) default for bare 10-digit numbers. */
export const normalizePhone = (raw, defaultCountry = '91') => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = defaultCountry + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
};

export function createEvolutionClient({ baseUrl = process.env.EVOLUTION_API_URL, apiKey = process.env.EVOLUTION_API_KEY, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  async function call(method, path, body) {
    if (!base || !apiKey) throw new EvolutionError('WhatsApp integration is not configured on the server', 503);
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new EvolutionError('WhatsApp service is unreachable. It may be waking up; try again in a minute.', 503);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new EvolutionError(res.status === 404 ? 'WhatsApp instance not found' : 'WhatsApp service request failed', res.status === 404 ? 404 : 502);
      err.upstreamStatus = res.status;
      throw err;
    }
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
    logout: (name) => call('DELETE', `/instance/logout/${enc(name)}`),
    sendText: (name, number, text) => call('POST', `/message/sendText/${enc(name)}`, { number, text }),
  };
}
