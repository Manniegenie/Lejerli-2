const crypto = require('crypto');
const axios = require('axios');

/**
 * Kraken API Service
 * Based on official Kraken REST API documentation
 * https://docs.kraken.com/api/
 *
 * READ-ONLY IMPLEMENTATION
 * Only includes endpoints that don't modify account state
 */

class KrakenService {
  constructor() {
    this.baseURL = 'https://api.kraken.com';
    this.apiVersion = '0';
    this.apiKey = null;
    this.apiSecret = null;
    this.isReadOnly = true;
  }

  /**
   * Initialize Kraken API client with user credentials
   * @param {string} apiKey - Kraken API Key
   * @param {string} apiSecret - Kraken API Secret (base64)
   * @returns {Object} Service instance
   */
  connect(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    console.log('⚠️  Ensure your Kraken API key has ONLY "Query Funds" and "Query Open/Closed Orders" permissions enabled');
    return this;
  }

  /**
   * Generate authentication signature for private endpoints
   * Kraken uses HMAC-SHA512 with base64-encoded secret
   */
  _generateSignature(path, postData, nonce) {
    const message = nonce + postData;
    const secret = Buffer.from(this.apiSecret, 'base64');
    const hash = crypto.createHash('sha256').update(message).digest();
    const hmac = crypto.createHmac('sha512', secret);
    const signatureHash = hmac.update(path + hash.toString('binary'), 'binary').digest('base64');
    return signatureHash;
  }

  /**
   * Make request to Kraken private API
   */
  async _makePrivateRequest(endpoint, params = {}) {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('Kraken client not initialized. Call connect() first.');
      }

      const nonce = Date.now() * 1000; // Kraken uses microsecond timestamps
      const path = `/${this.apiVersion}/private/${endpoint}`;
      const postData = new URLSearchParams({ ...params, nonce }).toString();

      const signature = this._generateSignature(path, postData, nonce);

      const response = await axios.post(
        `${this.baseURL}${path}`,
        postData,
        {
          headers: {
            'API-Key': this.apiKey,
            'API-Sign': signature,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(`Kraken API Error: ${response.data.error.join(', ')}`);
      }

      return response.data.result;
    } catch (error) {
      console.error(`Kraken private API error (${endpoint}):`, error.message);
      throw error;
    }
  }

  /**
   * Make request to Kraken public API
   */
  async _makePublicRequest(endpoint, params = {}) {
    try {
      const queryString = new URLSearchParams(params).toString();
      const url = `${this.baseURL}/${this.apiVersion}/public/${endpoint}${queryString ? '?' + queryString : ''}`;

      const response = await axios.get(url);

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(`Kraken API Error: ${response.data.error.join(', ')}`);
      }

      return response.data.result;
    } catch (error) {
      console.error(`Kraken public API error (${endpoint}):`, error.message);
      throw error;
    }
  }

  /**
   * Test connection and API key validity
   */
  async testConnection() {
    try {
      const balance = await this.getAccountBalance();
      return {
        success: true,
        message: 'Kraken connection successful',
        hasBalance: Object.keys(balance).length > 0
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * ========================================
   * ACCOUNT INFORMATION (Private - Read Only)
   * ========================================
   */

  /**
   * Get account balance
   * Returns: asset balances
   */
  async getAccountBalance() {
    return await this._makePrivateRequest('Balance');
  }

  /**
   * Get trade balance (includes margin info)
   * Returns: equivalent balance, margin, unrealized PnL
   */
  async getTradeBalance(options = {}) {
    return await this._makePrivateRequest('TradeBalance', options);
  }

  /**
   * ========================================
   * TRADING HISTORY (Private - Read Only)
   * ========================================
   */

  /**
   * Get trades history
   * Returns: trade history with fees, prices, volumes
   * @param {Object} options - Optional: type, trades, start, end, ofs
   */
  async getTradesHistory(options = {}) {
    return await this._makePrivateRequest('TradesHistory', options);
  }

  /**
   * Get information about specific trades
   * @param {string[]} txids - Transaction IDs
   */
  async queryTrades(txids) {
    return await this._makePrivateRequest('QueryTrades', { txid: txids.join(',') });
  }

  /**
   * ========================================
   * ORDERS (Private - Read Only)
   * ========================================
   */

  /**
   * Get open orders
   * Returns: open orders with details
   */
  async getOpenOrders(options = {}) {
    return await this._makePrivateRequest('OpenOrders', options);
  }

  /**
   * Get closed orders
   * Returns: closed orders history
   * @param {Object} options - Optional: trades, userref, start, end, ofs, closetime
   */
  async getClosedOrders(options = {}) {
    return await this._makePrivateRequest('ClosedOrders', options);
  }

  /**
   * Query specific orders by ID
   * @param {string[]} txids - Order transaction IDs
   */
  async queryOrders(txids) {
    return await this._makePrivateRequest('QueryOrders', { txid: txids.join(',') });
  }

  /**
   * ========================================
   * FUNDING (Private - Read Only)
   * ========================================
   */

  /**
   * Get deposit methods
   * @param {string} asset - Asset name (e.g., 'XBT', 'ETH')
   */
  async getDepositMethods(asset) {
    return await this._makePrivateRequest('DepositMethods', { asset });
  }

  /**
   * Get deposit addresses
   * @param {string} asset - Asset name
   * @param {string} method - Deposit method
   */
  async getDepositAddresses(asset, method) {
    return await this._makePrivateRequest('DepositAddresses', { asset, method });
  }

  /**
   * Get deposit status
   * @param {string} asset - Asset name
   * @param {string} method - Deposit method
   */
  async getDepositStatus(asset, method) {
    return await this._makePrivateRequest('DepositStatus', { asset, method });
  }

  /**
   * Get withdrawal information
   * Returns: withdrawal history and limits
   */
  async getWithdrawalStatus(asset, method) {
    return await this._makePrivateRequest('WithdrawStatus', { asset, method });
  }

  /**
   * ========================================
   * MARKET DATA (Public - No Auth Required)
   * ========================================
   */

  /**
   * Get server time
   */
  async getServerTime() {
    return await this._makePublicRequest('Time');
  }

  /**
   * Get system status
   */
  async getSystemStatus() {
    return await this._makePublicRequest('SystemStatus');
  }

  /**
   * Get tradable asset pairs
   * @param {Object} options - Optional: pair, info
   */
  async getAssetPairs(options = {}) {
    return await this._makePublicRequest('AssetPairs', options);
  }

  /**
   * Get ticker information
   * @param {string} pair - Asset pair (e.g., 'XBTUSD', 'ETHUSD')
   */
  async getTicker(pair) {
    return await this._makePublicRequest('Ticker', { pair });
  }

  /**
   * Get OHLC data
   * @param {string} pair - Asset pair
   * @param {Object} options - Optional: interval, since
   */
  async getOHLC(pair, options = {}) {
    return await this._makePublicRequest('OHLC', { pair, ...options });
  }

  /**
   * Get recent trades
   * @param {string} pair - Asset pair
   * @param {Object} options - Optional: since
   */
  async getRecentTrades(pair, options = {}) {
    return await this._makePublicRequest('Trades', { pair, ...options });
  }

  /**
   * Disconnect client
   */
  disconnect() {
    this.apiKey = null;
    this.apiSecret = null;
  }
}

module.exports = new KrakenService();
