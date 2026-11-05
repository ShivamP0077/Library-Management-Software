// Masks secrets in log output: URL credentials, bearer tokens, key=value secrets,
// and the literal values of sensitive environment variables.
const SENSITIVE = /(SECRET|PASSWORD|PASS|TOKEN|API_KEY|_KEY|MONGODB_URI)$/i;
let envValues = null;
function sensitiveValues() {
  if (!envValues) {
    envValues = Object.entries(process.env)
      .filter(([k, v]) => SENSITIVE.test(k) && v && v.length >= 6)
      .map(([, v]) => v)
      .sort((a, b) => b.length - a.length);
  }
  return envValues;
}
export function resetRedactCache() { envValues = null; }
export function redact(input) {
  let s = typeof input === 'string' ? input : String(input);
  s = s.replace(/\/\/[^@/\s]+@/g, '//****:****@');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '$1 ****');
  s = s.replace(/("?(?:password|pass|secret|token|api[_-]?key|key_secret|client_secret|authorization)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, '$1****');
  for (const v of sensitiveValues()) s = s.split(v).join('****');
  return s;
}
function redactArg(a) {
  if (typeof a === 'string') return redact(a);
  if (a instanceof Error) { const e = new Error(redact(a.message)); e.name = a.name; e.stack = redact(a.stack || ''); return e; }
  if (a && typeof a === 'object') { try { return redact(JSON.stringify(a)); } catch { return '[object]'; } }
  return a;
}
let installed = false;
export function installConsoleRedaction() {
  if (installed) return; installed = true;
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[m].bind(console);
    console[m] = (...args) => orig(...args.map(redactArg));
  }
}
