'use strict';

const axios   = require('axios');
const express = require('express');
const { protect } = require('../middleware/auth');

const ETH_RPC          = 'https://cloudflare-eth.com';
const ETHERSCAN_BASE   = 'https://api.etherscan.io/api';
const COINGECKO_PRICE  = 'https://api.coingecko.com/api/v3/simple/price';

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

async function fetchEthPrice() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
    return parseFloat(res.data?.price || '0');
  } catch {
    return 0;
  }
}

async function fetchTokenPrices(contractAddresses) {
  if (!contractAddresses.length) return {};
  try {
    const res = await axios.get(COINGECKO_PRICE, {
      params: {
        contract_addresses: contractAddresses.join(','),
        vs_currencies: 'usd',
        platform: 'ethereum',
      },
      timeout: 8000,
    });
    return res.data || {};
  } catch {
    return {};
  }
}

async function fetchBalancesWithUSD(address) {
  const apiKey = process.env.ETHERSCAN_API_KEY;

  const [balanceHex, ethPrice] = await Promise.all([
    rpc('eth_getBalance', [address, 'latest']),
    fetchEthPrice(),
  ]);

  const ethQty   = parseInt(balanceHex, 16) / 1e18;
  const results  = [];

  if (ethQty > 0) {
    results.push({
      asset:    'ETH',
      free:     ethQty.toFixed(8),
      locked:   '0',
      usdValue: (ethQty * ethPrice).toFixed(2),
    });
  }

  // ERC-20 tokens via Etherscan
  if (apiKey) {
    try {
      const tokenRes = await axios.get(ETHERSCAN_BASE, {
        params: {
          module:  'account',
          action:  'tokenlist',
          address,
          apikey:  apiKey,
        },
        timeout: 10000,
      });

      const tokens = tokenRes.data?.result;
      if (Array.isArray(tokens) && tokens.length) {
        const contractAddresses = tokens.map(t => t.contractAddress.toLowerCase());
        const prices = await fetchTokenPrices(contractAddresses);

        for (const token of tokens) {
          const qty = parseFloat(token.balance) / Math.pow(10, parseInt(token.decimals || '18'));
          if (qty <= 0) continue;

          const priceData = prices[token.contractAddress.toLowerCase()];
          const usdValue  = priceData?.usd ? (qty * priceData.usd).toFixed(2) : '0.00';

          results.push({
            asset:           token.symbol,
            name:            token.name,
            free:            qty.toFixed(8),
            locked:          '0',
            usdValue,
            contractAddress: token.contractAddress,
          });
        }

        // Sort by USD value descending
        results.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));
      }
    } catch (err) {
      console.error('[ethereum] ERC-20 fetch failed:', err.message);
    }
  }

  return results;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = express.Router();

router.get('/balances', protect, async (req, res) => {
  const ex = req.user.crypto?.exchanges?.metamask || req.user.crypto?.exchanges?.uniswap;
  if (!ex?.connected) {
    return res.status(400).json({ success: false, message: 'No EVM wallet connected' });
  }

  try {
    const keys    = req.user.decryptApiKeys('metamask') || req.user.decryptApiKeys('uniswap');
    const address = keys.apiKey;

    if (!validateAddress(address)) {
      return res.status(400).json({ success: false, message: 'Invalid wallet address stored' });
    }

    const data = await fetchBalancesWithUSD(address);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[ethereum/balances]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch Ethereum balances' });
  }
});

module.exports = router;
module.exports.validateAddress      = validateAddress;
module.exports.fetchBalancesWithUSD = fetchBalancesWithUSD;
