/**
 * Phantom / Solana — helper + routes
 *
 * Uses Solana JSON-RPC (mainnet-beta) to fetch SOL and SPL token balances.
 * Wallet address is stored encrypted as apiKey in user.crypto.exchanges.phantom.
 *
 * Exports:
 *   validateAddress(address) — returns true if valid Solana base58 address
 *   fetchBalancesWithUSD(walletAddress) — returns [{ asset, free, locked, usdValue }]
 */

const axios   = require('axios');
const express = require('express');
const { protect } = require('../middleware/auth');

const SOLANA_RPC       = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const STABLE = new Set(['USDC','USDT','BUSD','DAI','TUSD','FDUSD']);

function validateAddress(address) {
  return typeof address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

async function rpc(method, params) {
  const res = await axios.post(SOLANA_RPC, { jsonrpc: '2.0', id: 1, method, params });
  return res.data.result;
}

async function fetchBalancesWithUSD(walletAddress) {
  // Fetch SOL balance + all SPL token accounts + Binance prices in parallel
  const [balanceResult, tokenResult, priceRes] = await Promise.all([
    rpc('getBalance', [walletAddress, { commitment: 'confirmed' }]),
    rpc('getTokenAccountsByOwner', [
      walletAddress,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
    axios.get('https://api.binance.com/api/v3/ticker/price').catch(() => ({ data: [] })),
  ]);

  const priceMap = {};
  (priceRes.data || []).forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });
  const btcUsd = priceMap['BTCUSDT'] || 0;

  const result = [];

  // SOL balance
  const solLamports = balanceResult?.value || 0;
  const solQty      = solLamports / 1e9;
  if (solQty > 0) {
    const solUsd = priceMap['SOLUSDT'] ? solQty * priceMap['SOLUSDT'] : 0;
    result.push({ asset: 'SOL', free: solQty.toString(), locked: '0', usdValue: solUsd.toFixed(2) });
  }

  // SPL tokens
  for (const acct of (tokenResult?.value || [])) {
    const info = acct.account?.data?.parsed?.info;
    if (!info) continue;
    const mint = info.mint;
    const qty  = parseFloat(info.tokenAmount?.uiAmount || '0');
    if (qty === 0) continue;

    // Use mint address as asset identifier; map known mints to symbols
    const KNOWN_MINTS = {
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN':  'JUP',
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    };
    const asset = KNOWN_MINTS[mint] || mint.slice(0, 8);

    let usdValue = 0;
    if (STABLE.has(asset))                              usdValue = qty;
    else if (priceMap[`${asset}USDT`])                  usdValue = qty * priceMap[`${asset}USDT`];
    else if (priceMap[`${asset}BTC`] && btcUsd)         usdValue = qty * priceMap[`${asset}BTC`] * btcUsd;

    result.push({ asset, free: qty.toString(), locked: '0', usdValue: usdValue.toFixed(2) });
  }

  return result.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));
}

// ── Route: GET /phantom/balances ──────────────────────────────────────────────

const router = express.Router();

router.get('/balances', protect, async (req, res) => {
  const ex = req.user.crypto?.exchanges?.phantom;
  if (!ex?.connected) {
    return res.status(400).json({ success: false, message: 'Phantom is not connected' });
  }
  try {
    const keys    = req.user.decryptApiKeys('phantom');
    const address = keys.apiKey; // wallet address stored as apiKey
    const data    = await fetchBalancesWithUSD(address);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[phantom/balances]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch Solana balances' });
  }
});

module.exports = router;
module.exports.validateAddress      = validateAddress;
module.exports.fetchBalancesWithUSD = fetchBalancesWithUSD;
