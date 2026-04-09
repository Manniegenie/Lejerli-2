const { Spot } = require('@binance/connector');

/**
 * Binance Service for Data Aggregation
 *
 * Using Official Binance Connector: @binance/connector (latest)
 * Documentation: https://github.com/binance/binance-connector-js
 * NPM Package: @binance/connector
 *
 * IMPORTANT: This service is designed for READ-ONLY operations.
 * When creating your Binance API key:
 * 1. Enable ONLY "Read Info" permission
 * 2. DO NOT enable "Enable Trading"
 * 3. DO NOT enable "Enable Withdrawals"
 * 4. DO NOT enable "Enable Futures"
 *
 * This ensures the API key can only read data and cannot perform any trades or withdrawals.
 *
 * Installation: npm install @binance/connector
 */
class BinanceService {
  constructor() {
    this.client = null;
    this.isReadOnly = true; // Service operates in read-only mode
  }

  /**
   * Initialize Binance client with user API keys (READ-ONLY)
   * @param {string} apiKey - User's Binance API key (must have ONLY read permissions)
   * @param {string} apiSecret - User's Binance API secret
   * @param {Object} options - Optional configuration (baseURL for testnet, etc.)
   * @returns {Object} Binance client instance
   */
  connect(apiKey, apiSecret, options = {}) {
    try {
      if (!apiKey || !apiSecret) {
        throw new Error('API key and secret are required');
      }

      // Initialize the official Binance Spot connector
      this.client = new Spot(apiKey, apiSecret, options);

      console.log('Binance client connected in READ-ONLY mode');
      console.log('⚠️  Ensure your API key has ONLY "Read Info" permission enabled');

      return this.client;
    } catch (error) {
      console.error('Failed to connect to Binance:', error.message);
      throw error;
    }
  }

  /**
   * Test the connection by fetching account information
   * @param {Object} options - Optional parameters like recvWindow
   * @returns {Promise<Object>} Account information
   */
  async testConnection(options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.account(options);
      return {
        success: true,
        message: 'Connection successful',
        data: response.data,
      };
    } catch (error) {
      console.error('Connection test failed:', error.message);
      return {
        success: false,
        message: error.message,
        data: null,
      };
    }
  }

  /**
   * Get account balance
   * @param {Object} options - Optional parameters like recvWindow
   * @returns {Promise<Array>} Account balances (non-zero only)
   */
  async getAccountBalance(options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.account(options);
      const balances = response.data.balances || [];
      return balances.filter(balance => parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0);
    } catch (error) {
      console.error('Failed to fetch account balance:', error.message);
      throw error;
    }
  }

  /**
   * Get current prices for all symbols
   * @returns {Promise<Object>} Current prices for all trading pairs
   */
  async getPrices() {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.tickerPrice();
      return response.data;
    } catch (error) {
      console.error('Failed to fetch prices:', error.message);
      throw error;
    }
  }

  /**
   * Get price for a specific symbol
   * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDT')
   * @returns {Promise<Object>} Current price data for the symbol
   */
  async getPrice(symbol) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.tickerPrice(symbol);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch price for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * CORE AGGREGATOR DATA (Required for PnL)
   * ========================================
   */

  /**
   * 1. Get trade executions (fills) - CRITICAL for PnL
   * Returns: symbol, tradeId, orderId, price, qty, quoteQty, commission, commissionAsset, isBuyer, time
   * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
   * @param {Object} options - Optional params: limit, fromId, startTime, endTime
   * @returns {Promise<Array>} Array of trade executions with fees
   */
  async getMyTrades(symbol, options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.myTrades(symbol, options);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch trades for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * 2. Get current balances - Required for unrealized PnL
   * Already implemented as getAccountBalance()
   * Returns: asset, free, locked
   */

  /**
   * 3. Get market prices - Already implemented as getPrices() and getPrice()
   * Returns: symbol, price, timestamp
   */

  /**
   * ========================================
   * SYMBOL METADATA (Required for Normalization)
   * ========================================
   */

  /**
   * Get exchange information for symbols
   * Returns: baseAsset, quoteAsset, precision, step size
   * @param {string} symbol - Optional: specific symbol
   * @returns {Promise<Object>} Exchange info with symbol metadata
   */
  async getExchangeInfo(symbol = null) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const params = symbol ? { symbol } : {};
      const response = await this.client.exchangeInfo(params);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch exchange info:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * DEPOSITS & WITHDRAWALS (Recommended)
   * ========================================
   */

  /**
   * Get deposit history
   * Returns: asset, amount, timestamp, txId, status
   * @param {Object} options - Optional: coin, status, startTime, endTime, limit
   * @returns {Promise<Array>} Deposit history
   */
  async getDepositHistory(options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.depositHistory(options);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch deposit history:', error.message);
      throw error;
    }
  }

  /**
   * Get withdrawal history
   * Returns: asset, amount, timestamp, txId, fee, status
   * @param {Object} options - Optional: coin, status, startTime, endTime, limit
   * @returns {Promise<Array>} Withdrawal history
   */
  async getWithdrawHistory(options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.withdrawHistory(options);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch withdrawal history:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * ORDER HISTORY (Optional - for UX/Debugging)
   * ========================================
   */

  /**
   * Get all orders for a symbol
   * Returns: orderId, type, status, price, qty, time
   * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
   * @param {Object} options - Optional: orderId, startTime, endTime, limit
   * @returns {Promise<Array>} Order history
   */
  async getAllOrders(symbol, options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const response = await this.client.allOrders(symbol, options);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch orders for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get open orders
   * @param {string} symbol - Optional: specific symbol
   * @returns {Promise<Array>} Open orders
   */
  async getOpenOrders(symbol = null) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const params = symbol ? { symbol } : {};
      const response = await this.client.openOrders(params);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch open orders:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * BATCH OPERATIONS (Convenience Methods)
   * ========================================
   */

  /**
   * Get all trades across multiple symbols
   * @param {Array<string>} symbols - Array of trading pairs
   * @param {Object} options - Optional params for each symbol
   * @returns {Promise<Object>} Trades grouped by symbol
   */
  async getAllSymbolTrades(symbols, options = {}) {
    try {
      if (!this.client) {
        throw new Error('Binance client not initialized. Call connect() first.');
      }

      const tradePromises = symbols.map(symbol =>
        this.getMyTrades(symbol, options).catch(err => ({
          symbol,
          error: err.message,
          trades: []
        }))
      );

      const results = await Promise.all(tradePromises);

      return symbols.reduce((acc, symbol, index) => {
        acc[symbol] = results[index];
        return acc;
      }, {});
    } catch (error) {
      console.error('Failed to fetch trades for multiple symbols:', error.message);
      throw error;
    }
  }

  /**
   * Disconnect the Binance client
   */
  disconnect() {
    this.client = null;
  }
}

module.exports = new BinanceService();
