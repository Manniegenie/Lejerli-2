'use strict';

const mongoose = require('mongoose');

const CHANNEL_TYPE = Object.freeze({ CRYPTO: 'CRYPTO', FIAT: 'FIAT' });
const RATE_MODE = Object.freeze({ MANUAL: 'MANUAL', MARKDOWN: 'MARKDOWN' });

/**
 * Channel represents a liquidity lane — either a crypto asset
 * or a fiat currency corridor (with country and bank references).
 *
 * otcRate      — the manual override rate (USD per unit)
 * markupPercentage — applied on top of referenceSource rate when MARKDOWN mode
 * referenceSource  — external price feed ID (e.g. CoinGecko symbol or FX source)
 */
const channelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Channel name is required'],
      unique: true,
      trim: true,
      maxlength: 100,
      index: true,
    },

    type: {
      type: String,
      enum: Object.values(CHANNEL_TYPE),
      required: [true, 'Channel type is required'],
      index: true,
    },

    // ── Crypto-specific ────────────────────────────────
    asset: {
      type: String,
      uppercase: true,
      trim: true,
      // e.g. BTC, ETH, USDT
    },

    // ── Fiat-specific ──────────────────────────────────
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      // e.g. NGN, USD, GBP
    },

    country: {
      type: String,
      uppercase: true,
      trim: true,
      // ISO 3166-1 alpha-2, e.g. NG, US, GB
    },

    // ── Pricing ───────────────────────────────────────
    rateMode: {
      type: String,
      enum: Object.values(RATE_MODE),
      default: RATE_MODE.MANUAL,
    },

    otcRate: {
      type: mongoose.Types.Decimal128,
      get(v) {
        return v ? parseFloat(v.toString()) : null;
      },
      set(v) {
        return mongoose.Types.Decimal128.fromString(String(v));
      },
    },

    markupPercentage: {
      type: Number,
      default: 0,
      min: -100,
      max: 1000,
      // e.g. 2.5 means add 2.5% on top of reference rate
    },

    referenceSource: {
      type: String,
      trim: true,
      // e.g. 'bitcoin', 'ethereum' for CoinGecko; 'USD/NGN' for FX
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    /**
     * Flexible metadata bucket for:
     * - Crypto: { walletId, network, explorerUrl, contractAddress }
     * - Fiat: { bankId, bankCode, accountPattern, swiftCode }
     */
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

// Compound index: active channels by type (common query pattern in OTC)
channelSchema.index({ type: 1, isActive: 1 });
// Crypto asset lookup
channelSchema.index({ asset: 1 }, { sparse: true });
// Fiat currency lookup
channelSchema.index({ currency: 1, country: 1 }, { sparse: true });

const Channel = mongoose.model('Channel', channelSchema);

module.exports = { Channel, CHANNEL_TYPE, RATE_MODE };
