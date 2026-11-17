/**
 * These maintenance scripts may talk only to a MongoDB on this machine.
 * mongodb+srv, Atlas hostnames, and any other host are refused. There is no override.
 */

export function assertLocalMongoUri(uri) {
  const raw = String(uri || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) {
    const err = new Error('MONGODB_URI is empty');
    err.code = 'MONGO_URI_REFUSED';
    throw err;
  }
  if (/^mongodb\+srv:/i.test(raw)) {
    const err = new Error('Refusing mongodb+srv URI. This script only connects to 127.0.0.1 or localhost.');
    err.code = 'MONGO_URI_REFUSED';
    throw err;
  }
  if (!/^mongodb:\/\//i.test(raw)) {
    const err = new Error('Refusing non-mongodb URI. This script only connects to 127.0.0.1 or localhost.');
    err.code = 'MONGO_URI_REFUSED';
    throw err;
  }
  let rest = raw.slice('mongodb://'.length);
  const at = rest.lastIndexOf('@');
  if (at >= 0) rest = rest.slice(at + 1);
  const pathStart = rest.search(/[/?]/);
  const hostPart = (pathStart >= 0 ? rest.slice(0, pathStart) : rest).trim();
  if (!hostPart) {
    const err = new Error('Refusing MongoDB URI with no host.');
    err.code = 'MONGO_URI_REFUSED';
    throw err;
  }
  const hosts = hostPart.split(',').map((h) => h.trim()).filter(Boolean);
  for (const entry of hosts) {
    let host = entry;
    if (host.startsWith('[')) {
      const end = host.indexOf(']');
      host = end >= 0 ? host.slice(1, end) : host;
    } else {
      host = host.split(':')[0];
    }
    host = host.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') {
      const err = new Error(`Refusing MongoDB host "${host}". This script only connects to 127.0.0.1 or localhost.`);
      err.code = 'MONGO_URI_REFUSED';
      throw err;
    }
  }
  return raw;
}

export const DEFAULT_LOCAL_URI = 'mongodb://127.0.0.1:27017/library_management';

export function resolveLocalMongoUri(env = process.env) {
  const configured = env.MONGODB_URI;
  return assertLocalMongoUri(configured && String(configured).trim() ? configured : DEFAULT_LOCAL_URI);
}
