import jwt from 'jsonwebtoken';
import { User, Library } from './models.js';

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  return s || 'dev-insecure-secret-change-me';
};

export const signToken = (user) => {
  const tenantId = user.tenantId || user.libraryId || null;
  return jwt.sign(
    { sub: String(user._id), role: user.role, tenantId, libraryId: tenantId, email: user.email, name: user.name },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
};

/** Verifies the Bearer token AND re-checks the account/library are still active. */
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    let payload;
    try { payload = jwt.verify(h.slice(7), secret()); } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
    const user = await User.findById(payload.sub).lean();
    if (!user || user.status !== 'Active') return res.status(401).json({ error: 'Account disabled or not found' });
    // The database is the source of truth for the tenant. A token minted for a
    // different tenant (e.g. after reassignment) must not be accepted.
    const tenantId = user.tenantId || user.libraryId || null;
    if (payload.tenantId !== undefined && payload.tenantId !== tenantId) {
      return res.status(401).json({ error: 'Token tenant does not match account' });
    }
    if (user.role !== 'superadmin') {
      const lib = await Library.findOne({ libraryId: tenantId }).lean();
      if (!lib || lib.status !== 'Active') return res.status(403).json({ error: 'Library is disabled' });
    }
    // Identity always comes from the database record, never from the request body
    req.user = { id: String(user._id), role: user.role, tenantId, libraryId: tenantId, email: user.email, name: user.name, staffId: user.staffId || null };
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden' });

/**
 * Resolves the tenant for data routes into req.tenantId (and req.libraryId as a
 * compatibility alias).
 * - client_admin / staff: ALWAYS their own tenant from the account. Any tenant
 *   in headers, query or body is ignored.
 * - superadmin: must pick a library via the X-Library-Id header (drill-in). Sending
 *   X-Read-Only: 1 makes the session read-only (writes rejected).
 */
export async function tenantScope(req, res, next) {
  try {
    if (req.user.role === 'superadmin') {
      const target = req.get('X-Library-Id');
      if (!target) return res.status(400).json({ error: 'Super admin must specify X-Library-Id to access library data' });
      const lib = await Library.findOne({ libraryId: target }).lean();
      if (!lib) return res.status(404).json({ error: 'Library not found' });
      req.tenantId = lib.libraryId;
      req.libraryId = lib.libraryId; // compatibility alias
      req.readOnly = ['1', 'true'].includes(String(req.get('X-Read-Only') || '').toLowerCase());
    } else {
      const tenantId = req.user.tenantId || req.user.libraryId || null;
      req.tenantId = tenantId;
      req.libraryId = tenantId; // compatibility alias
      req.readOnly = false;
    }
    if (req.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: 'Read-only session' });
    }
    next();
  } catch (e) { next(e); }
}
