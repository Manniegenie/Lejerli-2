/**
 * Ethereum / EVM — helper + routes
 *
 * Uses Cloudflare's free public Ethereum node (no API key needed).
 * Fetches ETH balance + prices via Binance public ticker.
 *
 * Exports:
 *   validateAddress(address)       — returns true if valid 0x EVM address
 *   fetchBalancesWithUSD(address)  — returns [{ asset, free, locked, usdValue }]
 */

const axios   = require('axios');
const express = require('express');
const { protect } = require('../middleware/auth');

const ETH_RPC = 'https://cloudflare-eth.com';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateAddress(address) {
  return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address);
}

async function rpc(method, params) {
  const res = await axios.post(ETH_RPC, {
    jsonrpc: '2.0', id: 1, method, params,
  });
  if (res.data.error) throw new Error(res.data.error.message);
  return res.data.result;
}

/**
 * Fetches ETH balance for an address, enriched with USD value.
 * ERC-20 tokens are not included (requires Etherscan API key).
 */
async function fetchBalancesWithUSD(address) {
  const [balanceHex, priceRes] = await Promise.all([
    rpc('eth_getBalance', [address, 'latest']),
    axios.get('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT').catch(() => ({ data: { price: '0' } })),
  ]);

  const ethQty   = parseInt(balanceHex, 16) / 1e18;
  const ethPrice = parseFloat(priceRes.data?.price || '0');
  const usdValue = ethQty * ethPrice;

  if (ethQty === 0) return [];

  return [{
    asset:    'ETH',
    free:     ethQty.toString(),
    locked:   '0',
    usdValue: usdValue.toFixed(2),
  }];
}

// ── Route: GET /ethereum/balances ─────────────────────────────────────────────

const router = express.Router();

router.get('/balances', protect, async (req, res) => {
  // Supports metamask or uniswap (both EVM wallets)
  const ex = req.user.crypto?.exchanges?.metamask || req.user.crypto?.exchanges?.uniswap;
  if (!ex?.connected) {
    return res.status(400).json({ success: false, message: 'No EVM wallet connected' });
  }

  try {
    const keys    = req.user.decryptApiKeys('metamask') || req.user.decryptApiKeys('uniswap');
    const address = keys.apiKey;
    const data    = await fetchBalancesWithUSD(address);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[ethereum/balances]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch Ethereum balances' });
  }
});

module.exports = router;
module.exports.validateAddress     = validateAddress;
module.exports.fetchBalancesWithUSD = fetchBalancesWithUSD;
