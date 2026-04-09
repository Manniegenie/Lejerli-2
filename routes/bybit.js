/**
 * Bybit API v5 — helper + routes
 *
 * Auth: HMAC-SHA256
 *   message  = timestamp + apiKey + recvWindow + queryString
 *   headers  = X-BAPI-API-KEY, X-BAPI-SIGN, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW
 *
 * Exports:
 *   validateKeys(apiKey, apiSecret)       — throws if credentials are invalid
 *   fetchAccountsWithUSD(apiKey, apiSecret) — returns enriched balance array
 */

const crypto  = require('crypto');
const axios   = require('axios');
const express = require('express');
const { protect } = require('../middleware/auth');

const BASE        = 'https://api.bybit.com';
const RECV_WINDOW = '5000';

// ── Signing ───────────────────────────────────────────────────────────────────

function buildHeaders(apiKey, apiSecret, queryString = '') {
  const timestamp = Date.now().toString();
  const message   = `${timestamp}${apiKey}${RECV_WINDOW}${queryString}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  return {
    'X-BAPI-API-KEY':    apiKey,
    'X-BAPI-SIGN':       signature,
    'X-BAPI-TIMESTAMP':  timestamp,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    'Content-Type':      'application/json',
  };
}

// ── Core API helpers ─────────────────────────────────────────────────────────

/**
 * Fetches unified account wallet balance from Bybit v5.
 * Returns raw coin array: [{ coin, walletBalance, usdValue, ... }]
 */
async function fetchWalletBalance(apiKey, apiSecret) {
  const query = 'accountType=UNIFIED';
  const res   = await axios.get(`${BASE}/v5/account/wallet-balance?${query}`, {
    headers: buildHeaders(apiKey, apiSecret, query),
  });

  if (res.data.retCode !== 0) {
    throw new Error(`Bybit error ${res.data.retCode}: ${res.data.retMsg}`);
  }

  // Unified account returns one item in list
  return res.data.result?.list?.[0]?.coin || [];
}

/**
 * Validates that the provided keys can authenticate with Bybit.
 * Throws an error if they can't.
 */
async function validateKeys(apiKey, apiSecret) {
  await fetchWalletBalance(apiKey, apiSecret);
}

/**
 * Returns balances enriched with USD values.
 * Bybit provides usdValue per coin directly — no extra price fetch needed.
 */
async function fetchAccountsWithUSD(apiKey, apiSecret) {
  const coins = await fetchWalletBalance(apiKey, apiSecret);

  return coins
    .filter(c => parseFloat(c.walletBalance || '0') > 0)
    .map(c => {
      const total = parseFloat(c.walletBalance || '0');
      const free  = parseFloat(c.availableToWithdraw || c.availableBalance || '0');
      const locked = Math.max(0, total - free);
      return {
        asset:    c.coin,
        free:     free.toString(),
        locked:   locked.toFixed(8),
        usdValue: parseFloat(c.usdValue || '0').toFixed(2),
      };
    })
    .sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));
}

// ── Route: GET /bybit/accounts ────────────────────────────────────────────────

const router = express.Router();

router.get('/accounts', protect, async (req, res) => {
  const ex = req.user.crypto?.exchanges?.bybit_spot;
  if (!ex?.connected) {
    return res.status(400).json({ success: false, message: 'Bybit is not connected' });
  }

  try {
    const keys     = req.user.decryptApiKeys('bybit_spot');
    const balances = await fetchAccountsWithUSD(keys.apiKey, keys.apiSecret);
    return res.status(200).json({ success: true, data: balances });
  } catch (err) {
    console.error('[bybit/accounts]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch Bybit accounts' });
  }
});

module.exports = router;
module.exports.validateKeys         = validateKeys;
module.exports.fetchAccountsWithUSD = fetchAccountsWithUSD;
