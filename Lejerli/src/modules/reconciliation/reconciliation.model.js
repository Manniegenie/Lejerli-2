'use strict';

const mongoose = require('mongoose');

const RECON_STATUS = Object.freeze({
  AUTO_MATCHED: 'AUTO_MATCHED',
  MANUAL_MATCHED: 'MANUAL_MATCHED',
  FLAGGED: 'FLAGGED',
});

/**
 * ReconciliationRecord — links one crypto transaction to one fiat transaction.
 *
 * matchScore      — 0–100 confidence score for the match
 * toleranceUsed   — the USD tolerance window applied during matching
 * resolvedBy      — userId who performed manual match (null for AUTO)
 * notes           — ops team commentary for flagged/manual records
 */
const reconciliationRecordSchema = new mongoose.Schema(
  {
    cryptoTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: [true, 'cryptoTransactionId is required'],
      index: true,
    },

    fiatTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: [true, 'fiatTransactionId is required'],
      index: true,
    },

    matchScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },

    toleranceUsed: {
      type: mongoose.Types.Decimal128,
      required: true,
      get(v) {
        return v ? parseFloat(v.toString()) : null;
      },
      set(v) {
        return mongoose.Types.Decimal128.fromString(String(v));
      },
    },

    status: {
      type: String,
      enum: Object.values(RECON_STATUS),
      default: RECON_STATUS.AUTO_MATCHED,
      index: true,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    notes: {
      type: String,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
    toJSON: {
      getters: true,
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Unique pair constraint — one crypto tx can only be matched to one fiat tx
reconciliationRecordSchema.index(
  { cryptoTransactionId: 1, fiatTransactionId: 1 },
  { unique: true }
);

// Status filter for ops dashboard
reconciliationRecordSchema.index({ status: 1, createdAt: -1 });

const ReconciliationRecord = mongoose.model(
  'ReconciliationRecord',
  reconciliationRecordSchema
);

module.exports = { ReconciliationRecord, RECON_STATUS };
