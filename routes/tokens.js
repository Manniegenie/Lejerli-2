const express = require('express');
const axios   = require('axios');
const router  = express.Router();

// ─── Cache — icons barely change, 24 h is fine ───────────────────────────────
let iconCache   = {};
let lastFetched = null;
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ─── Fetch top 500 coins from CoinGecko (2 pages × 250) ─────────────────────
const buildIconMap = async () => {
  const now     = Date.now();
  const isFresh = Object.keys(iconCache).length > 0 && lastFetched && (now - lastFetched) < CACHE_TTL;
  if (isFresh) return iconCache;

  const map = {};

  for (const page of [1, 2]) {
    try {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
        params : {
          vs_currency : 'usd',
          order       : 'market_cap_desc',
          per_page    : 250,
          page        : page,
          sparkline   : false,
        },
        timeout : 10_000,
        headers : { 'User-Agent': 'LejerliApp/1.0' },
      });

      data.forEach((coin) => {
        map[coin.symbol.toUpperCase()] = coin.image; // e.g. BTC → https://...
      });

      console.log(`✅ [tokens] page ${page} — ${data.length} coins loaded`);
    } catch (err) {
      console.error(`⚠️  [tokens] page ${page} failed: ${err.message}`);
    }
  }

  if (Object.keys(map).length > 0) {
    iconCache   = map;
    lastFetched = now;
  }

  return iconCache;
};

// ─── GET /tokens/icons — full symbol → URL map ────────────────────────────────
router.get('/icons', async (req, res) => {
  try {
    const icons = await buildIconMap();
    return res.status(200).json({
      success : true,
      data    : icons,
      meta    : { total: Object.keys(icons).length, cachedAt: lastFetched },
    });
  } catch (error) {
    console.error('Tokens /icons error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /tokens/icons/:symbol — single lookup ───────────────────────────────
router.get('/icons/:symbol', async (req, res) => {
  try {
    const icons  = await buildIconMap();
    const symbol = req.params.symbol.toUpperCase();
    const url    = icons[symbol];

    if (!url) {
      return res.status(404).json({ success: false, message: `No icon found for ${symbol}` });
    }

    return res.status(200).json({ success: true, data: { symbol, url } });
  } catch (error) {
    console.error('Tokens /:symbol error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
