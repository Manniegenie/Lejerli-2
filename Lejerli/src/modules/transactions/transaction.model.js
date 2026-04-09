'use strict';

const mongoose = require('mongoose');

const TX_TYPE = Object.freeze({ CRYPTO: 'CRYPTO', FIAT: 'FIAT' });
const TX_DIRECTION = Object.freeze({ IN: 'IN', OUT: 'OUT' });
const TX_STATUS = Object.freeze({
  PENDING: 'PENDING',
  MATCHED: 'MATCHED',
  PARTIAL: 'PARTIAL',
  UNMATCHED: 'UNMATCHED',
});

/**
 * Transaction — the canonical ledger record.
 *
 * Every deposit or withdrawal (crypto or fiat) creates one Transaction.
 * The reconciliation engine links crypto ↔ fiat transactions via
 * ReconciliationRecord using the reference field as a correlation handle.
 *
 * usdValue        — normalised USD equivalent at time of capture
 * rateAtExecution — the channel OTC rate applied (USD per unit)
 * counterparty    — wallet address (crypto) or bank account identifier (fiat)
 * reference       — business reference / external ID for matching
 */
const transactionSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel',
      required: [true, 'channelId is required'],
      index: true,
    },

    type: {
      type: String,
      enum: Object.values(TX_TYPE),
      required: [true, 'Transaction type is required'],
    },

    direction: {
      type: String,
      enum: Object.values(TX_DIRECTION),
      required: [true, 'Direction is required'],
    },

    asset: {
      type: String,
      uppercase: true,
      trim: true,
      // e.g. BTC, USDT, NGN
    },

    amount: {
      type: mongoose.Types.Decimal128,
      required: [true, 'Amount is required'],
      get(v) {
        return v ? parseFloat(v.toString()) : null;
      },
      set(v) {
        return mongoose.Types.Decimal128.fromString(String(v));
      },
    },

    usdValue: {
      type: mongoose.Types.Decimal128,
      required: [true, 'USD value is required'],
      get(v) {
        return v ? parseFloat(v.toString()) : null;
      },
      set(v) {
        return mongoose.Types.Decimal128.fromString(String(v));
      },
    },

    rateAtExecution: {
      type: mongoose.Types.Decimal128,
      get(v) {
        return v ? parseFloat(v.toString()) : null;
      },
      set(v) {
        return v !== undefined ? mongoose.Types.Decimal128.fromString(String(v)) : v;
      },
    },

    counterparty: {
      type: String,
      trim: true,
      maxlength: 300,
      // wallet address or bank account number
    },

    reference: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      // External/business reference used for reconciliation matching
    },

    status: {
      type: String,
      enum: Object.values(TX_STATUS),
      default: TX_STATUS.PENDING,
      index: true,
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Internal audit trail for status changes
    statusHistory: [
      {
        status: { type: String, enum: Object.values(TX_STATUS) },
        changedAt: { type: Date, default: Date.now },
        note: String,
      },
    ],

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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

// ── Indexes ──────────────────────────────────────────────────────────────
// PRD-required indexes
transactionSchema.index({ channelId: 1 });
transactionSchema.index({ timestamp: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ reference: 1 });

// Compound: common reconciliation query
transactionSchema.index({ type: 1, status: 1, timestamp: -1 });
// Channel + direction analytics
transactionSchema.index({ channelId: 1, direction: 1, timestamp: -1 });

// ── Pre-save hook ────────────────────────────────────────────────────────

transactionSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.statusHistory.push({ status: this.status, changedAt: new Date() });
  }
  next();
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = { Transaction, TX_TYPE, TX_DIRECTION, TX_STATUS };
