/**
 * Issue #16: durable, immutable record of a library deletion.
 *
 * The job is written before any destructive work and is the recovery point for a
 * retry if the process dies halfway through. It is a platform-level collection
 * (no tenantId) and is never deleted by the tenant cleanup.
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  libraryId: { type: String, required: true, unique: true, index: true },
  targetName: { type: String, required: true, immutable: true },
  subject: { type: String, required: true }, // pseudonymous tenant reference
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  counts: mongoose.Schema.Types.Mixed,
  retention: mongoose.Schema.Types.Mixed,
  whatsapp: String,
  error: String,
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true });

export const DeletionJob = mongoose.models.DeletionJob
  || mongoose.model('DeletionJob', schema);
