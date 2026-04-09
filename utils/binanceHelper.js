const binanceService = require('../services/binance');
const User = require('../models/user');
const Transaction = require('../models/transaction');

/**
 * Binance Helper Utility with Rate Limiting & Data Persistence
 *
 * BINANCE RATE LIMITS (Spot API):
 * - Weight-based: 6,000 weight per minute (1,200 per IP)
 * - Order-based: 50,000 orders per 10 seconds
 * - Account endpoint: weight 20
 * - myTrades endpoint: weight 20 per symbol
 * - Deposit/Withdraw history: weight 1 each
 *
 * SYNC STRATEGY:
 * - Full sync every 5 minutes (safe buffer from rate limits)
 * - Incremental sync (only new data) to minimize API calls
 * - Stagger requests to avoid bursts
 */

// Active sync jobs per user
const activeSyncJobs = new Map();

// Rate limit tracker
const rateLimitTracker = {
  weight: 0,
  resetTime: Date.now() + 60000, // 1 minute window

  async checkAndWait(weight) {
    const now = Date.now();

    // Reset if window passed
    if (now >= this.resetTime) {
      this.weight = 0;
      this.resetTime = now + 60000;
    }

    // If adding this weight exceeds limit, wait
    if (this.weight + weight > 5000) { // Safe limit (buffer from 6000)
      const waitTime = this.resetTime - now;
      console.log(`Rate limit approaching, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.weight = 0;
      this.resetTime = Date.now() + 60000;
    }

    this.weight += weight;
  }
};

/**
 * Check if user has wallet connected and initialize Binance service
 * @param {string} userId - MongoDB user ID
 * @returns {Promise<Object>} Result object with connection status and client
 */
async function connectUserBinanceWallet(userId) {
  try {
    // Find user by ID
    const user = await User.findById(userId);

    if (!user) {
      return {
        success: false,
        connected: false,
        message: 'User not found',
        client: null
      };
    }

    // Check if Binance wallet is connected
    if (!user.binanceWallet.connected) {
      return {
        success: false,
        connected: false,
        message: 'Binance wallet not connected',
        client: null
      };
    }

    // Decrypt API keys
    const credentials = user.decryptApiKeys();

    if (!credentials) {
      return {
        success: false,
        connected: false,
        message: 'Failed to decrypt API keys',
        client: null
      };
    }

    // Connect to Binance with user's API keys
    const client = binanceService.connect(credentials.apiKey, credentials.apiSecret);

    // Test the connection
    const connectionTest = await binanceService.testConnection();

    if (!connectionTest.success) {
      return {
        success: false,
        connected: true,
        message: `Connection test failed: ${connectionTest.message}`,
        client: null
      };
    }

    // Update last synced timestamp
    user.binanceWallet.lastSynced = new Date();
    await user.save();

    return {
      success: true,
      connected: true,
      message: 'Binance wallet connected successfully',
      client: binanceService,
      accountData: connectionTest.data
    };

  } catch (error) {
    console.error('Error connecting user Binance wallet:', error.message);
    return {
      success: false,
      connected: false,
      message: error.message,
      client: null
    };
  }
}

/**
 * Get user's Binance account balances
 * @param {string} userId - MongoDB user ID
 * @returns {Promise<Object>} Balances or error
 */
async function getUserBalances(userId) {
  const connection = await connectUserBinanceWallet(userId);

  if (!connection.success) {
    return {
      success: false,
      message: connection.message,
      balances: null
    };
  }

  try {
    const balances = await binanceService.getAccountBalance();

    return {
      success: true,
      message: 'Balances retrieved successfully',
      balances: balances
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      balances: null
    };
  }
}

/**
 * Get user's trade history for a symbol
 * @param {string} userId - MongoDB user ID
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {Object} options - Optional parameters (limit, startTime, endTime)
 * @returns {Promise<Object>} Trades or error
 */
async function getUserTrades(userId, symbol, options = {}) {
  const connection = await connectUserBinanceWallet(userId);

  if (!connection.success) {
    return {
      success: false,
      message: connection.message,
      trades: null
    };
  }

  try {
    const trades = await binanceService.getMyTrades(symbol, options);

    return {
      success: true,
      message: 'Trades retrieved successfully',
      trades: trades
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      trades: null
    };
  }
}

/**
 * Get user's deposit history
 * @param {string} userId - MongoDB user ID
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} Deposits or error
 */
async function getUserDeposits(userId, options = {}) {
  const connection = await connectUserBinanceWallet(userId);

  if (!connection.success) {
    return {
      success: false,
      message: connection.message,
      deposits: null
    };
  }

  try {
    const deposits = await binanceService.getDepositHistory(options);

    return {
      success: true,
      message: 'Deposits retrieved successfully',
      deposits: deposits
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      deposits: null
    };
  }
}

/**
 * Get user's withdrawal history
 * @param {string} userId - MongoDB user ID
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} Withdrawals or error
 */
async function getUserWithdrawals(userId, options = {}) {
  const connection = await connectUserBinanceWallet(userId);

  if (!connection.success) {
    return {
      success: false,
      message: connection.message,
      withdrawals: null
    };
  }

  try {
    const withdrawals = await binanceService.getWithdrawHistory(options);

    return {
      success: true,
      message: 'Withdrawals retrieved successfully',
      withdrawals: withdrawals
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      withdrawals: null
    };
  }
}

/**
 * Check wallet connection status without connecting
 * @param {string} userId - MongoDB user ID
 * @returns {Promise<Object>} Connection status
 */
async function checkWalletStatus(userId) {
  try {
    const user = await User.findById(userId);

    if (!user) {
      return {
        connected: false,
        message: 'User not found'
      };
    }

    return {
      connected: user.binanceWallet.connected,
      connectedAt: user.binanceWallet.connectedAt,
      lastSynced: user.binanceWallet.lastSynced,
      message: user.binanceWallet.connected
        ? 'Binance wallet is connected'
        : 'Binance wallet is not connected'
    };
  } catch (error) {
    return {
      connected: false,
      message: error.message
    };
  }
}

/**
 * Disconnect user's Binance wallet
 * @param {string} userId - MongoDB user ID
 * @returns {Promise<Object>} Disconnect result
 */
async function disconnectUserWallet(userId) {
  try {
    const user = await User.findById(userId);

    if (!user) {
      return {
        success: false,
        message: 'User not found'
      };
    }

    // Clear wallet data
    user.binanceWallet = {
      connected: false,
      apiKey: null,
      apiSecret: null,
      iv: null,
      connectedAt: null,
      lastSynced: null
    };

    await user.save();

    // Disconnect the service
    binanceService.disconnect();

    return {
      success: true,
      message: 'Binance wallet disconnected successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Sync user's Binance data and store in database
 * @param {string} userId - MongoDB user ID
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync result
 */
async function syncUserData(userId, options = {}) {
  const {
    symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'], // Default symbols to sync
    fullSync = false // If true, fetch all data; if false, only new data
  } = options;

  try {
    // Connect to user's Binance
    const connection = await connectUserBinanceWallet(userId);

    if (!connection.success) {
      return {
        success: false,
        message: connection.message,
        synced: { trades: 0, deposits: 0, withdrawals: 0 }
      };
    }

    const syncResult = {
      trades: 0,
      deposits: 0,
      withdrawals: 0,
      errors: []
    };

    // Get last sync time for incremental sync
    const lastTradeSync = fullSync ? null : await Transaction.getLastSyncTime(userId, 'trade');
    const lastDepositSync = fullSync ? null : await Transaction.getLastSyncTime(userId, 'deposit');
    const lastWithdrawalSync = fullSync ? null : await Transaction.getLastSyncTime(userId, 'withdrawal');

    // Sync trades for each symbol (with rate limiting)
    for (const symbol of symbols) {
      try {
        await rateLimitTracker.checkAndWait(20); // myTrades weight = 20

        const tradeOptions = lastTradeSync
          ? { startTime: lastTradeSync.getTime() + 1, limit: 1000 }
          : { limit: 1000 };

        const trades = await binanceService.getMyTrades(symbol, tradeOptions);

        // Store trades in database
        for (const trade of trades) {
          const stored = await Transaction.storeTrade(userId, trade);
          if (stored) syncResult.trades++;
        }

        // Small delay to avoid bursts
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        syncResult.errors.push(`${symbol}: ${error.message}`);
      }
    }

    // Sync deposits (with rate limiting)
    try {
      await rateLimitTracker.checkAndWait(1); // depositHistory weight = 1

      const depositOptions = lastDepositSync
        ? { startTime: lastDepositSync.getTime() + 1, limit: 1000 }
        : { limit: 1000 };

      const deposits = await binanceService.getDepositHistory(depositOptions);

      for (const deposit of deposits) {
        const stored = await Transaction.storeDeposit(userId, deposit);
        if (stored) syncResult.deposits++;
      }

    } catch (error) {
      syncResult.errors.push(`Deposits: ${error.message}`);
    }

    // Sync withdrawals (with rate limiting)
    try {
      await rateLimitTracker.checkAndWait(1); // withdrawHistory weight = 1

      const withdrawalOptions = lastWithdrawalSync
        ? { startTime: lastWithdrawalSync.getTime() + 1, limit: 1000 }
        : { limit: 1000 };

      const withdrawals = await binanceService.getWithdrawHistory(withdrawalOptions);

      for (const withdrawal of withdrawals) {
        const stored = await Transaction.storeWithdrawal(userId, withdrawal);
        if (stored) syncResult.withdrawals++;
      }

    } catch (error) {
      syncResult.errors.push(`Withdrawals: ${error.message}`);
    }

    // Update user's last synced time
    const user = await User.findById(userId);
    user.binanceWallet.lastSynced = new Date();
    await user.save();

    return {
      success: true,
      message: `Synced ${syncResult.trades} trades, ${syncResult.deposits} deposits, ${syncResult.withdrawals} withdrawals`,
      synced: syncResult
    };

  } catch (error) {
    return {
      success: false,
      message: error.message,
      synced: { trades: 0, deposits: 0, withdrawals: 0 }
    };
  }
}

/**
 * Start auto-sync for a user (runs every 5 minutes)
 * @param {string} userId - MongoDB user ID
 * @param {Object} options - Sync options
 * @returns {Object} Sync job info
 */
function startAutoSync(userId, options = {}) {
  // Check if already syncing
  if (activeSyncJobs.has(userId)) {
    return {
      success: false,
      message: 'Auto-sync already running for this user'
    };
  }

  const {
    interval = 5 * 60 * 1000, // 5 minutes (safe for rate limits)
    symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']
  } = options;

  // Initial sync
  syncUserData(userId, { symbols, fullSync: false })
    .then(result => console.log(`Initial sync for ${userId}:`, result.message))
    .catch(err => console.error(`Initial sync error for ${userId}:`, err.message));

  // Schedule recurring sync
  const intervalId = setInterval(async () => {
    try {
      const result = await syncUserData(userId, { symbols, fullSync: false });
      console.log(`Auto-sync for ${userId}:`, result.message);
    } catch (error) {
      console.error(`Auto-sync error for ${userId}:`, error.message);
    }
  }, interval);

  activeSyncJobs.set(userId, {
    intervalId,
    startedAt: new Date(),
    interval,
    symbols
  });

  return {
    success: true,
    message: `Auto-sync started (every ${interval / 1000}s)`,
    job: activeSyncJobs.get(userId)
  };
}

/**
 * Stop auto-sync for a user
 * @param {string} userId - MongoDB user ID
 * @returns {Object} Stop result
 */
function stopAutoSync(userId) {
  const job = activeSyncJobs.get(userId);

  if (!job) {
    return {
      success: false,
      message: 'No active auto-sync for this user'
    };
  }

  clearInterval(job.intervalId);
  activeSyncJobs.delete(userId);

  return {
    success: true,
    message: 'Auto-sync stopped'
  };
}

/**
 * Get auto-sync status for a user
 * @param {string} userId - MongoDB user ID
 * @returns {Object} Sync status
 */
function getAutoSyncStatus(userId) {
  const job = activeSyncJobs.get(userId);

  if (!job) {
    return {
      active: false,
      message: 'No active auto-sync'
    };
  }

  return {
    active: true,
    startedAt: job.startedAt,
    interval: job.interval,
    symbols: job.symbols,
    message: `Auto-sync running (every ${job.interval / 1000}s)`
  };
}

module.exports = {
  connectUserBinanceWallet,
  getUserBalances,
  getUserTrades,
  getUserDeposits,
  getUserWithdrawals,
  checkWalletStatus,
  disconnectUserWallet,
  // New methods for data persistence & auto-sync
  syncUserData,
  startAutoSync,
  stopAutoSync,
  getAutoSyncStatus
};
