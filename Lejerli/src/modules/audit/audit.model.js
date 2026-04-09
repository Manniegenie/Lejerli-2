'use strict';

const mongoose = require('mongoose');

/**
 * AuditLog — immutable event trail for compliance and forensics.
 *
 * entity     — the collection/domain name (e.g. 'Channel', 'Transaction')
 * entityId   — the MongoDB ObjectId of the affected document
 * oldValue   — snapshot of the document before change (or null for creates)
 * newValue   — snapshot after change (or null for deletes)
 *
 * Logs are append-only; never updated or deleted.
 * TTL index expires records after 7 years for regulatory compliance.
 */
const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      // null for system-generated actions
    },

    action: {
      type: String,
      required: [true, 'Action is required'],
      trim: true,
      maxlength: 100,
      // e.g. 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'RECON_MATCH'
      index: true,
    },

    entity: {
      type: String,
      required: [true, 'Entity is required'],
      trim: true,
      maxlength: 100,
      index: true,
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'EntityId is required'],
      index: true,
    },

    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    ipAddress: {
      type: String,
      trim: true,
    },

    userAgent: {
      type: String,
      trim: true,
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    // No updatedAt — audit logs are immutable
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Entity timeline lookups
auditLogSchema.index({ entity: 1, entityId: 1, timestamp: -1 });
// User activity stream
auditLogSchema.index({ userId: 1, timestamp: -1 });

// TTL: retain audit logs for 7 years (regulatory compliance)
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 7 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = { AuditLog };
