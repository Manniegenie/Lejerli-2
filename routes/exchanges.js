const express = require('express');
const axios   = require('axios');
const router  = express.Router();

// ─── Whitelisted connectable CEX (CoinGecko exchange IDs) ────────────────────
const SUPPORTED_EXCHANGES = [
  'binance', 'coinbase', 'kraken', 'okx', 'bybit_spot',
  'kucoin',  'bitfinex', 'bitstamp', 'gemini', 'gate',
  'htx',     'mexc',
];

// ─── Cache — logos rarely change, 6 h TTL ────────────────────────────────────
let exchangeCache = [];
let lastFetched   = null;
const CACHE_TTL   = 6 * 60 * 60 * 1000;

const buildExchangeList = async () => {
  const now     = Date.now();
  const isFresh = exchangeCache.length > 0 && lastFetched && (now - lastFetched) < CACHE_TTL;
  if (isFresh) return exchangeCache;

  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/exchanges', {
      params : { per_page: 100, page: 1 },
      timeout: 10_000,
      headers: { 'User-Agent': 'LejerliApp/1.0' },
    });

    const filtered = data
      .filter(ex => SUPPORTED_EXCHANGES.includes(ex.id))
      .map(ex => ({
        id         : ex.id,
        name       : ex.name,
        image      : ex.image,
        url        : ex.url,
        trustScore : ex.trust_score,
      }));

    // Preserve the whitelist order
    const ordered = SUPPORTED_EXCHANGES
      .map(id => filtered.find(ex => ex.id === id))
      .filter(Boolean);

    exchangeCache = ordered;
    lastFetched   = now;
    console.log(`✅ [exchanges] ${ordered.length} exchanges loaded`);
  } catch (err) {
    console.error(`⚠️  [exchanges] fetch failed: ${err.message}`);
  }

  return exchangeCache;
};

// ─── GET /exchanges ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await buildExchangeList();
    return res.status(200).json({
      success : true,
      data,
      meta    : { total: data.length, cachedAt: lastFetched },
    });
  } catch (error) {
    console.error('[exchanges] route error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
