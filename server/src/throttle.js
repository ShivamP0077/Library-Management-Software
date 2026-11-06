// Persistent per-identifier throttle for login/OTP abuse protection (Issue #15 AUTH-06).
import crypto from 'crypto';
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  count: { type: Number, default: 0 },
  windowStart: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });
export const AuthThrottle = mongoose.models.AuthThrottle || mongoose.model('AuthThrottle', schema);

const keyOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** Returns true when this key has exceeded max attempts in the rolling window. */
export async function throttleHit(key, max, windowMs) {
  const k = keyOf(key);
  const now = Date.now();
  const startsAt = new Date(now - windowMs);
  let doc = await AuthThrottle.findOne({ key: k });
  if (!doc || !doc.windowStart || doc.windowStart < startsAt) {
    await AuthThrottle.updateOne(
      { key: k },
      { $set: { count: 1, windowStart: new Date(now), expiresAt: new Date(now + windowMs) } },
      { upsert: true },
    );
    return false;
  }
  doc = await AuthThrottle.findOneAndUpdate({ key: k }, { $inc: { count: 1 } }, { new: true });
  return (doc?.count || 0) > max;
}

export async function clearThrottle(key) {
  await AuthThrottle.deleteOne({ key: keyOf(key) });
}

export async function resetThrottles() {
  await AuthThrottle.deleteMany({});
}
