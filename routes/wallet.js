const express    = require('express');
const router     = express.Router();
const { Spot }   = require('@binance/connector');
const { protect } = require('../middleware/auth');
const { validateKeys: validateCoinbaseKeys, fetchAccountsWithUSD: fetchCoinbaseBalances } = require('./coinbase');
const { validateKeys: validateBybitKeys,   fetchAccountsWithUSD: fetchBybitBalances   } = require('./bybit');
const { validateAddress: validateSolanaAddress, fetchBalancesWithUSD: fetchPhantomBalances  } = require('./phantom');
const { fetchBalancesWithUSD: fetchEthBalances } = require('./ethereum');

// ── Shared validation ─────────────────────────────────────────────────────────
function validateKeys(apiKey, apiSecret) {
  if (!apiKey || !apiSecret)
    return 'Please provide both API key and API secret';
  if (typeof apiKey !== 'string' || apiKey.trim().length < 10)
    return 'Invalid API key format';
  if (typeof apiSecret !== 'string' || apiSecret.trim().length < 10)
    return 'Invalid API secret format';
  return null;
}

// ── POST /wallet/:exchange  (binance | kraken | coinbase | bybit_spot | DEX) ──
const VALID_EXCHANGES  = ['binance', 'kraken', 'coinbase', 'bybit_spot', 'phantom', 'metamask', 'trust', 'jupiter', 'uniswap', 'raydium'];
const DEX_EXCHANGES    = new Set(['phantom', 'metamask', 'trust', 'jupiter', 'uniswap', 'raydium']);
const SOLANA_EXCHANGES = new Set(['phantom', 'jupiter', 'raydium']);

router.post('/:exchange', protect, async (req, res) => {
  const { exchange } = req.params;

  if (!VALID_EXCHANGES.includes(exchange)) {
    return res.status(400).json({ success: false, message: `Invalid exchange: ${exchange}` });
  }

  // DEX wallets — connect by wallet address, not API keys
  if (DEX_EXCHANGES.has(exchange)) {
    const { walletAddress } = req.body;
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Please provide a valid wallet address' });
    }
    const addr = walletAddress.trim();
    if (SOLANA_EXCHANGES.has(exchange) && !validateSolanaAddress(addr)) {
      return res.status(400).json({ success: false, message: 'Invalid Solana wallet address format' });
    }
    try {
      const user      = req.user;
      const encrypted = user.encryptApiKeys(addr, '');
      user.crypto.exchanges[exchange] = {
        connected: true, apiKey: encrypted.apiKey, apiSecret: encrypted.apiSecret,
        iv: encrypted.iv, connectedAt: new Date(), lastSynced: null,
      };
      await user.save();
      return res.status(200).json({
        success: true,
        message: `${exchange} wallet connected successfully`,
        data: { exchange, connected: true, connectedAt: user.crypto.exchanges[exchange].connectedAt },
      });
    } catch (error) {
      console.error(`[wallet] ${exchange} dex connect error:`, error.message);
      return res.status(500).json({ success: false, message: 'Error connecting wallet', error: error.message });
    }
  }

  const { apiKey, apiSecret } = req.body;
  const validationError = validateKeys(apiKey, apiSecret);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  try {
    // Validate keys against the exchange before storing anything
    if (exchange === 'binance') {
      try {
        const testClient = new Spot(apiKey.trim(), apiSecret.trim());
        await testClient.account();
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Invalid Binance API credentials — check your key and secret.' });
      }
    }

    if (exchange === 'coinbase') {
      try {
        await validateCoinbaseKeys(apiKey.trim(), apiSecret.trim());
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Invalid Coinbase API credentials — check your key and secret.' });
      }
    }

    if (exchange === 'bybit_spot') {
      try {
        await validateBybitKeys(apiKey.trim(), apiSecret.trim());
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Invalid Bybit API credentials — check your key and secret.' });
      }
    }

    const user      = req.user;
    const encrypted = user.encryptApiKeys(apiKey.trim(), apiSecret.trim());

    user.crypto.exchanges[exchange] = {
      connected:   true,
      apiKey:      encrypted.apiKey,
      apiSecret:   encrypted.apiSecret,
      iv:          encrypted.iv,
      connectedAt: new Date(),
      lastSynced:  null,
    };

    await user.save();

    return res.status(200).json({
      success: true,
      message: `${exchange} connected successfully`,
      data: {
        exchange,
        connected:   true,
        connectedAt: user.crypto.exchanges[exchange].connectedAt,
      },
    });
  } catch (error) {
    console.error(`[wallet] ${exchange} connect error:`, error.message);
    return res.status(500).json({ success: false, message: 'Error connecting wallet', error: error.message });
  }
});

// ── GET /wallet/status ────────────────────────────────────────────────────────
router.get('/status', protect, (req, res) => {
  const exchanges = req.user.crypto?.exchanges || {};

  const status = {};
  VALID_EXCHANGES.forEach(ex => {
    const snap = exchanges[ex]?.snapshot || {};
    status[ex] = {
      connected:   exchanges[ex]?.connected   || false,
      connectedAt: exchanges[ex]?.connectedAt || null,
      lastSynced:  exchanges[ex]?.lastSynced  || null,
      snapshot: exchanges[ex]?.connected ? {
        totalUSD:    snap.totalUSD    ?? null,
        assetCount:  snap.balances?.length ?? 0,
        canTrade:    snap.canTrade    ?? null,
        lastUpdated: snap.lastUpdated ?? null,
      } : null,
    };
  });

  return res.status(200).json({ success: true, data: status });
});

// ── GET /wallet/balances/:exchange ───────────────────────────────────────────
// Hits the exchange live and returns ALL account balances (including zero-balance).
// Used by the Tree modal so users can track any asset, not just their holdings.
router.get('/balances/:exchange', protect, async (req, res) => {
  const { exchange } = req.params;
  if (!VALID_EXCHANGES.includes(exchange)) {
    return res.status(400).json({ success: false, message: `Invalid exchange: ${exchange}` });
  }
  const ex = req.user.crypto?.exchanges?.[exchange];
  if (!ex?.connected) {
    return res.status(400).json({ success: false, message: `${exchange} is not connected` });
  }

  if (exchange === 'phantom' || exchange === 'jupiter' || exchange === 'raydium') {
    try {
      const keys     = req.user.decryptApiKeys(exchange);
      const balances = await fetchPhantomBalances(keys.apiKey);
      return res.status(200).json({ success: true, data: balances });
    } catch (err) {
      console.error(`[wallet/balances] ${exchange}: ${err.message}`);
      return res.status(200).json({ success: true, data: ex.snapshot?.balances || [], warning: 'Using cached snapshot' });
    }
  }

  if (exchange === 'metamask' || exchange === 'uniswap') {
    try {
      const keys     = req.user.decryptApiKeys(exchange);
      const balances = await fetchEthBalances(keys.apiKey);
      return res.status(200).json({ success: true, data: balances });
    } catch (err) {
      console.error(`[wallet/balances] ${exchange}: ${err.message}`);
      return res.status(200).json({ success: true, data: ex.snapshot?.balances || [], warning: 'Using cached snapshot' });
    }
  }

  if (exchange === 'coinbase') {
    try {
      const keys     = req.user.decryptApiKeys('coinbase');
      const balances = await fetchCoinbaseBalances(keys.apiKey, keys.apiSecret);
      return res.status(200).json({ success: true, data: balances });
    } catch (err) {
      console.error(`[wallet/balances] coinbase: ${err.message}`);
      return res.status(200).json({ success: true, data: ex.snapshot?.balances || [], warning: 'Using cached snapshot' });
    }
  }

  if (exchange === 'bybit_spot') {
    try {
      const keys     = req.user.decryptApiKeys('bybit_spot');
      const balances = await fetchBybitBalances(keys.apiKey, keys.apiSecret);
      return res.status(200).json({ success: true, data: balances });
    } catch (err) {
      console.error(`[wallet/balances] bybit_spot: ${err.message}`);
      return res.status(200).json({ success: true, data: ex.snapshot?.balances || [], warning: 'Using cached snapshot' });
    }
  }

  if (exchange !== 'binance') {
    // Fallback to stored snapshot for other exchanges
    return res.status(200).json({ success: true, data: ex.snapshot?.balances || [] });
  }

  try {
    const keys   = req.user.decryptApiKeys(exchange);
    const { Spot } = require('@binance/connector');
    const client = new Spot(keys.apiKey, keys.apiSecret);

    const [accountRes, priceRes] = await Promise.all([
      client.account(),
      client.tickerPrice(),
    ]);

    const priceMap = {};
    priceRes.data.forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });

    const STABLE  = new Set(['USDT','BUSD','USDC','DAI','TUSD','FDUSD']);
    const btcUsd  = priceMap['BTCUSDT'] || 0;

    const balances = accountRes.data.balances
      // Include all assets that have ever existed or currently held
      .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0 || b.asset)
      .map(b => {
        const qty = parseFloat(b.free) + parseFloat(b.locked);
        let usdValue = 0;
        if (STABLE.has(b.asset))                               usdValue = qty;
        else if (priceMap[`${b.asset}USDT`])                   usdValue = qty * priceMap[`${b.asset}USDT`];
        else if (priceMap[`${b.asset}BTC`] && btcUsd)          usdValue = qty * priceMap[`${b.asset}BTC`] * btcUsd;
        else if (priceMap[`${b.asset}ETH`] && priceMap['ETHUSDT'])
          usdValue = qty * priceMap[`${b.asset}ETH`] * priceMap['ETHUSDT'];
        return { asset: b.asset, free: b.free, locked: b.locked, usdValue: usdValue.toFixed(2) };
      })
      .sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));

    return res.status(200).json({ success: true, data: balances });
  } catch (err) {
    console.error(`[wallet/balances] ${exchange}: ${err.message}`);
    // Fallback to stored snapshot if live call fails
    return res.status(200).json({ success: true, data: ex.snapshot?.balances || [], warning: 'Using cached snapshot' });
  }
});

// ── DELETE /wallet/:exchange ──────────────────────────────────────────────────
router.delete('/:exchange', protect, async (req, res) => {
  const { exchange } = req.params;

  if (!VALID_EXCHANGES.includes(exchange)) {
    return res.status(400).json({ success: false, message: `Invalid exchange: ${exchange}` });
  }

  try {
    const user = req.user;

    if (!user.crypto.exchanges[exchange]?.connected) {
      return res.status(400).json({ success: false, message: `${exchange} is not connected` });
    }

    user.crypto.exchanges[exchange] = {
      connected: false, apiKey: null, apiSecret: null,
      iv: null, connectedAt: null, lastSynced: null,
    };

    await user.save();

    return res.status(200).json({ success: true, message: `${exchange} disconnected successfully` });
  } catch (error) {
    console.error(`[wallet] ${exchange} disconnect error:`, error.message);
    return res.status(500).json({ success: false, message: 'Error disconnecting wallet', error: error.message });
  }
});

module.exports = router;
