const mongoose = require('mongoose');

/**
 * AuditLog — immutable event trail, ported from Lejerli-2/Lejerli/src/modules/audit/
 * (the abandoned Fastify rewrite) since the schema itself is framework-agnostic.
 *
 * entity   — the collection/domain name (e.g. 'RoomRoleAssignment', 'FloorMembership')
 * entityId — the MongoDB ObjectId of the affected document
 * oldValue — snapshot before change (or null for creates)
 * newValue — snapshot after change (or null for deletes)
 *
 * Written on role assignment/removal and floor-member removal (§4 — the latter
 * must trigger desk-side key rotation once Step 4 lands; this log records the
 * event even before the rotation itself exists). Logs are append-only.
 */
const auditLogSchema = new mongoose.Schema({
  deskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  action: { type: String, required: true, trim: true, maxlength: 100, index: true },
  entity: { type: String, required: true, trim: true, maxlength: 100, index: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

  oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
  newValue: { type: mongoose.Schema.Types.Mixed, default: null },

  ipAddress: { type: String, trim: true },
  userAgent: { type: String, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ deskId: 1, createdAt: -1 });

// TTL: retain for 7 years (regulatory compliance), matching the ported pattern.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 7 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
