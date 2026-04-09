/**
 * Coinbase Advanced Trade API v3 — helper + routes
 *
 * Auth: HMAC-SHA256
 *   message  = timestamp + METHOD + path + body
 *   headers  = CB-ACCESS-KEY, CB-ACCESS-SIGN, CB-ACCESS-TIMESTAMP
 *
 * Exports:
 *   validateKeys(apiKey, apiSecret)  — throws if credentials are invalid
 *   fetchAccounts(apiKey, apiSecret) — returns raw accounts array
 *   fetchAccountsWithUSD(apiKey, apiSecret) — returns enriched balance array
 */

const crypto  = require('crypto');
const axios   = require('axios');
const express = require('express');
const { protect } = require('../middleware/auth');

const BASE = 'https://api.coinbase.com';

const STABLE = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD', 'GUSD']);

// ── Signing ───────────────────────────────────────────────────────────────────

function buildHeaders(apiKey, apiSecret, method, path, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message   = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  return {
    'CB-ACCESS-KEY':       apiKey,
    'CB-ACCESS-SIGN':      signature,
    'CB-ACCESS-TIMESTAMP': timestamp,
    'Content-Type':        'application/json',
  };
}

// ── Core API helpers ─────────────────────────────────────────────────────────

/**
 * Returns the raw accounts array from Coinbase Advanced Trade.
 * Throws on invalid credentials or network error.
 */
async function fetchAccounts(apiKey, apiSecret) {
  const path = '/api/v3/brokerage/accounts?limit=250';
  const res  = await axios.get(`${BASE}${path}`, {
    headers: buildHeaders(apiKey, apiSecret, 'GET', path),
  });
  return res.data.accounts || [];
}

/**
 * Validates that the provided keys can authenticate with Coinbase.
 * Throws an error if they can't.
 */
async function validateKeys(apiKey, apiSecret) {
  await fetchAccounts(apiKey, apiSecret);
}

/**
 * Returns balances enriched with USD values.
 * Uses Binance public ticker for crypto prices (no extra auth needed).
 */
async function fetchAccountsWithUSD(apiKey, apiSecret) {
  const [accounts, priceRes] = await Promise.all([
    fetchAccounts(apiKey, apiSecret),
    axios.get('https://api.binance.com/api/v3/ticker/price').catch(() => ({ data: [] })),
  ]);

  const priceMap = {};
  (priceRes.data || []).forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });
  const btcUsd = priceMap['BTCUSDT'] || 0;

  const result = [];
  for (const acct of accounts) {
    const asset = acct.currency;
    const free  = parseFloat(acct.available_balance?.value || '0');
    const held  = parseFloat(acct.hold?.value || '0');
    const qty   = free + held;
    if (qty === 0) continue;

    let usdValue = 0;
    if (STABLE.has(asset)) {
      usdValue = qty;
    } else if (priceMap[`${asset}USDT`]) {
      usdValue = qty * priceMap[`${asset}USDT`];
    } else if (priceMap[`${asset}BTC`] && btcUsd) {
      usdValue = qty * priceMap[`${asset}BTC`] * btcUsd;
    } else if (priceMap[`${asset}ETH`] && priceMap['ETHUSDT']) {
      usdValue = qty * priceMap[`${asset}ETH`] * priceMap['ETHUSDT'];
    }

    result.push({
      asset,
      free:     free.toString(),
      locked:   held.toString(),
      usdValue: usdValue.toFixed(2),
    });
  }

  return result.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));
}

// ── Route: GET /coinbase/accounts ─────────────────────────────────────────────
// Returns live enriched balances for the authenticated user's connected Coinbase account.

const router = express.Router();

router.get('/accounts', protect, async (req, res) => {
  const ex = req.user.crypto?.exchanges?.coinbase;
  if (!ex?.connected) {
    return res.status(400).json({ success: false, message: 'Coinbase is not connected' });
  }

  try {
    const keys     = req.user.decryptApiKeys('coinbase');
    const balances = await fetchAccountsWithUSD(keys.apiKey, keys.apiSecret);
    return res.status(200).json({ success: true, data: balances });
  } catch (err) {
    console.error('[coinbase/accounts]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch Coinbase accounts' });
  }
});

module.exports = router;
module.exports.validateKeys        = validateKeys;
module.exports.fetchAccountsWithUSD = fetchAccountsWithUSD;
