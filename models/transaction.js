const mongoose = require('mongoose');

/**
 * Transaction Model
 * Stores all Binance trading data for PnL calculations
 */

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  exchange: {
    type: String,
    default: 'binance',
    enum: ['binance', 'coinbase', 'kraken', 'okx']
  },

  // ========================================
  // TRADE DATA (fills) - CRITICAL for PnL
  // ========================================
  tradeData: {
    symbol: {
      type: String,
      required: true,
      index: true
    },
    tradeId: {
      type: Number,
      required: true,
      unique: true
    },
    orderId: {
      type: Number,
      required: true
    },
    price: {
      type: String,
      required: true
    },
    qty: {
      type: String,
      required: true
    },
    quoteQty: {
      type: String,
      required: true
    },
    // Fees are critical for PnL
    commission: {
      type: String,
      required: true
    },
    commissionAsset: {
      type: String,
      required: true
    },
    isBuyer: {
      type: Boolean,
      required: true
    },
    isMaker: {
      type: Boolean,
      default: false
    },
    time: {
      type: Date,
      required: true,
      index: true
    }
  },

  // ========================================
  // TRANSACTION TYPE
  // ========================================
  type: {
    type: String,
    required: true,
    enum: ['trade', 'deposit', 'withdrawal'],
    index: true
  },

  // ========================================
  // DEPOSIT DATA (for balance reconciliation)
  // ========================================
  depositData: {
    asset: String,
    amount: String,
    txId: String,
    status: {
      type: String,
      enum: ['pending', 'success', 'failed']
    },
    network: String,
    address: String,
    addressTag: String,
    insertTime: Date
  },

  // ========================================
  // WITHDRAWAL DATA (for balance reconciliation)
  // ========================================
  withdrawalData: {
    asset: String,
    amount: String,
    txId: String,
    fee: String,
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'cancelled']
    },
    network: String,
    address: String,
    addressTag: String,
    applyTime: Date,
    completeTime: Date
  },

  // ========================================
  // METADATA
  // ========================================
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  syncedAt: {
    type: Date,
    default: Date.now
  },

  // Raw data from exchange (for debugging)
  rawData: {
    type: mongoose.Schema.Types.Mixed
  }
});

// Compound indexes for efficient queries
transactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
transactionSchema.index({ userId: 1, 'tradeData.symbol': 1, 'tradeData.time': -1 });
transactionSchema.index({ userId: 1, 'tradeData.tradeId': 1 });

// Static method to store trade
transactionSchema.statics.storeTrade = async function(userId, trade) {
  try {
    const transaction = new this({
      userId,
      exchange: 'binance',
      type: 'trade',
      tradeData: {
        symbol: trade.symbol,
        tradeId: trade.id,
        orderId: trade.orderId,
        price: trade.price,
        qty: trade.qty,
        quoteQty: trade.quoteQty,
        commission: trade.commission,
        commissionAsset: trade.commissionAsset,
        isBuyer: trade.isBuyer,
        isMaker: trade.isMaker || false,
        time: new Date(trade.time)
      },
      rawData: trade
    });

    await transaction.save();
    return transaction;
  } catch (error) {
    // If duplicate tradeId, skip (already stored)
    if (error.code === 11000) {
      return null;
    }
    throw error;
  }
};

// Static method to store deposit
transactionSchema.statics.storeDeposit = async function(userId, deposit) {
  try {
    const transaction = new this({
      userId,
      exchange: 'binance',
      type: 'deposit',
      depositData: {
        asset: deposit.coin,
        amount: deposit.amount,
        txId: deposit.txId,
        status: deposit.status === 1 ? 'success' : 'pending',
        network: deposit.network,
        address: deposit.address,
        addressTag: deposit.addressTag,
        insertTime: new Date(deposit.insertTime)
      },
      createdAt: new Date(deposit.insertTime),
      rawData: deposit
    });

    await transaction.save();
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return null;
    }
    throw error;
  }
};

// Static method to store withdrawal
transactionSchema.statics.storeWithdrawal = async function(userId, withdrawal) {
  try {
    const transaction = new this({
      userId,
      exchange: 'binance',
      type: 'withdrawal',
      withdrawalData: {
        asset: withdrawal.coin,
        amount: withdrawal.amount,
        txId: withdrawal.txId,
        fee: withdrawal.transactionFee,
        status: withdrawal.status === 6 ? 'success' : 'pending',
        network: withdrawal.network,
        address: withdrawal.address,
        addressTag: withdrawal.addressTag,
        applyTime: new Date(withdrawal.applyTime),
        completeTime: withdrawal.completeTime ? new Date(withdrawal.completeTime) : null
      },
      createdAt: new Date(withdrawal.applyTime),
      rawData: withdrawal
    });

    await transaction.save();
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return null;
    }
    throw error;
  }
};

// Get last sync time for a user
transactionSchema.statics.getLastSyncTime = async function(userId, type = 'trade') {
  const lastTransaction = await this.findOne({ userId, type })
    .sort({ 'tradeData.time': -1, createdAt: -1 })
    .select('tradeData.time createdAt');

  if (!lastTransaction) {
    return null;
  }

  return type === 'trade'
    ? lastTransaction.tradeData?.time
    : lastTransaction.createdAt;
};

module.exports = mongoose.model('Transaction', transactionSchema);
