import mongoose from 'mongoose';
import dns from 'dns';

/**
 * Some networks (corporate / sandboxed resolvers) cannot answer SRV/TXT queries,
 * which breaks `mongodb+srv://` URIs. If the SRV lookup fails we resolve the
 * seed list over DNS-over-HTTPS and build an equivalent standard `mongodb://` URI.
 */
async function dohQuery(name, type) {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
  if (!res.ok) throw new Error(`DoH ${type} lookup failed: ${res.status}`);
  const json = await res.json();
  return (json.Answer || []).map(a => a.data);
}

export async function resolveMongoUri(uri) {
  if (!uri || !uri.startsWith('mongodb+srv://')) return uri;
  const parsed = new URL(uri.replace('mongodb+srv://', 'http://'));
  const host = parsed.hostname;
  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
    return uri; // system resolver works, let the driver handle SRV itself
  } catch {
    console.warn('[db] System DNS could not resolve SRV record, falling back to DNS-over-HTTPS');
  }
  const srv = await dohQuery(`_mongodb._tcp.${host}`, 'SRV');
  if (!srv.length) throw new Error(`No SRV records found for ${host}`);
  const hosts = srv.map(r => { const [, , port, target] = r.split(' '); return `${target.replace(/\.$/, '')}:${port}`; });
  const txt = (await dohQuery(host, 'TXT').catch(() => [])).map(t => t.replace(/"/g, '')).join('&');
  const params = new URLSearchParams(txt);
  for (const [k, v] of parsed.searchParams) params.set(k, v);
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');
  const auth = parsed.username ? `${parsed.username}${parsed.password ? ':' + parsed.password : ''}@` : '';
  const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/';
  return `mongodb://${auth}${hosts.join(',')}${path}?${params.toString()}`;
}

export function buildUriFromEnv(env = process.env) {
  let uri = (env.MONGODB_URI || '').trim().replace(/^['"]|['"]$/g, '');
  if (!uri) throw new Error('MONGODB_URI is not set');
  // Inject credentials from separate vars if the URI does not already carry them.
  const isLocal = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(uri);
  if (env.MONGODB_USERNAME && !isLocal && !/\/\/[^/]*@/.test(uri)) {
    const cred = `${encodeURIComponent(env.MONGODB_USERNAME)}:${encodeURIComponent(env.MONGODB_PASSWORD || '')}@`;
    uri = uri.replace('://', `://${cred}`);
  }
  return uri;
}

export const redact = (s) => String(s).replace(/\/\/[^@/]+@/g, '//****:****@');

export async function connectDB() {
  const raw = buildUriFromEnv();
  const uri = await resolveMongoUri(raw);
  const dbName = process.env.MONGODB_DB || 'library_management';
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 15000 });
  console.log(`[db] Connected to MongoDB database "${mongoose.connection.name}"`);
  return mongoose.connection;
}
