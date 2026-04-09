const crypto = require('crypto');
const axios = require('axios');

/**
 * Coinbase Advanced Trade API Service
 * Based on official Coinbase Advanced Trade API documentation
 * https://docs.cdp.coinbase.com/advanced-trade/docs/welcome
 *
 * READ-ONLY IMPLEMENTATION
 * Only includes endpoints that don't modify account state
 */

class CoinbaseService {
  constructor() {
    this.baseURL = 'https://api.coinbase.com/api/v3/brokerage';
    this.apiKey = null;
    this.apiSecret = null;
    this.isReadOnly = true;
  }

  /**
   * Initialize Coinbase API client with user credentials
   * @param {string} apiKey - Coinbase API Key
   * @param {string} apiSecret - Coinbase API Secret
   * @returns {Object} Service instance
   */
  connect(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    console.log('⚠️  Ensure your Coinbase API key has ONLY "View" permissions enabled (no trading or transfer permissions)');
    return this;
  }

  /**
   * Generate JWT token for authentication
   * Coinbase Advanced Trade uses JWT (JSON Web Token) authentication
   */
  _generateJWT(requestPath, method = 'GET') {
    const algorithm = 'ES256';
    const uri = `${method} ${requestPath}`;

    // JWT Header
    const header = {
      alg: algorithm,
      kid: this.apiKey,
      nonce: crypto.randomBytes(16).toString('hex')
    };

    // JWT Payload
    const payload = {
      sub: this.apiKey,
      iss: 'coinbase-cloud',
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120, // 2 minutes expiry
      uri
    };

    // Create JWT manually (Coinbase uses ES256 which requires special handling)
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createSign('SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .sign(this.apiSecret, 'base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Make authenticated request to Coinbase API
   */
  async _makeRequest(endpoint, method = 'GET', params = {}) {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('Coinbase client not initialized. Call connect() first.');
      }

      const requestPath = `/api/v3/brokerage${endpoint}`;
      const jwt = this._generateJWT(requestPath, method);

      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        }
      };

      if (method === 'GET' && Object.keys(params).length > 0) {
        config.params = params;
      } else if (method === 'POST' && Object.keys(params).length > 0) {
        config.data = params;
      }

      const response = await axios(config);
      return response.data;

    } catch (error) {
      if (error.response) {
        const errorMsg = error.response.data?.message || error.response.data?.error || error.message;
        console.error(`Coinbase API error (${endpoint}):`, errorMsg);
        throw new Error(`Coinbase API Error: ${errorMsg}`);
      }
      console.error(`Coinbase API error (${endpoint}):`, error.message);
      throw error;
    }
  }

  /**
   * Test connection and API key validity
   */
  async testConnection() {
    try {
      const accounts = await this.getAccounts();
      return {
        success: true,
        message: 'Coinbase connection successful',
        accountCount: accounts.accounts?.length || 0
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
   * ACCOUNTS (Read Only)
   * ========================================
   */

  /**
   * Get all accounts
   * Returns: list of accounts with balances
   * @param {Object} options - Optional: limit, cursor
   */
  async getAccounts(options = {}) {
    return await this._makeRequest('/accounts', 'GET', options);
  }

  /**
   * Get specific account
   * @param {string} accountId - Account UUID
   */
  async getAccount(accountId) {
    return await this._makeRequest(`/accounts/${accountId}`, 'GET');
  }

  /**
   * ========================================
   * ORDERS (Read Only)
   * ========================================
   */

  /**
   * List orders
   * Returns: order history
   * @param {Object} options - Optional: product_id, order_status, limit, start_date, end_date, cursor
   */
  async listOrders(options = {}) {
    return await this._makeRequest('/orders/batch', 'GET', options);
  }

  /**
   * Get specific order
   * @param {string} orderId - Order ID
   */
  async getOrder(orderId) {
    return await this._makeRequest(`/orders/historical/${orderId}`, 'GET');
  }

  /**
   * ========================================
   * FILLS (Trade History - Read Only)
   * ========================================
   */

  /**
   * Get fills (trade executions)
   * Returns: executed trades with fees
   * @param {Object} options - Optional: order_id, product_id, start_date, end_date, limit, cursor
   */
  async getFills(options = {}) {
    return await this._makeRequest('/fills', 'GET', options);
  }

  /**
   * ========================================
   * PRODUCTS (Market Data - Read Only)
   * ========================================
   */

  /**
   * List all products
   * Returns: all trading pairs
   * @param {Object} options - Optional: limit, offset, product_type
   */
  async listProducts(options = {}) {
    return await this._makeRequest('/products', 'GET', options);
  }

  /**
   * Get specific product
   * @param {string} productId - Product ID (e.g., 'BTC-USD')
   */
  async getProduct(productId) {
    return await this._makeRequest(`/products/${productId}`, 'GET');
  }

  /**
   * Get product candles (OHLCV data)
   * @param {string} productId - Product ID
   * @param {Object} options - start, end, granularity
   */
  async getProductCandles(productId, options = {}) {
    return await this._makeRequest(`/products/${productId}/candles`, 'GET', options);
  }

  /**
   * Get product ticker
   * @param {string} productId - Product ID
   */
  async getProductTicker(productId) {
    return await this._makeRequest(`/products/${productId}/ticker`, 'GET');
  }

  /**
   * Get market trades (recent trades)
   * @param {string} productId - Product ID
   * @param {Object} options - Optional: limit
   */
  async getMarketTrades(productId, options = {}) {
    return await this._makeRequest(`/products/${productId}/ticker`, 'GET', options);
  }

  /**
   * ========================================
   * TRANSACTIONS (Read Only)
   * ========================================
   */

  /**
   * Get transaction summary
   * Returns: overview of transactions
   * @param {Object} options - Optional: start_date, end_date, user_native_currency, product_type
   */
  async getTransactionSummary(options = {}) {
    return await this._makeRequest('/transaction_summary', 'GET', options);
  }

  /**
   * ========================================
   * PORTFOLIOS (Read Only)
   * ========================================
   */

  /**
   * List portfolios
   * Returns: all portfolios
   */
  async listPortfolios() {
    return await this._makeRequest('/portfolios', 'GET');
  }

  /**
   * Get specific portfolio
   * @param {string} portfolioId - Portfolio UUID
   */
  async getPortfolio(portfolioId) {
    return await this._makeRequest(`/portfolios/${portfolioId}`, 'GET');
  }

  /**
   * ========================================
   * FEES (Read Only)
   * ========================================
   */

  /**
   * Get transaction fee rates
   * Returns: maker and taker fee rates
   */
  async getTransactionFeeSummary() {
    return await this._makeRequest('/transaction_summary', 'GET');
  }

  /**
   * Disconnect client
   */
  disconnect() {
    this.apiKey = null;
    this.apiSecret = null;
  }
}

module.exports = new CoinbaseService();
