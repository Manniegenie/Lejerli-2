const express = require('express');
const axios   = require('axios');
const router  = express.Router();

// ─── In-memory cache ─────────────────────────────────────────────────────────
let newsCache   = [];
let lastFetched = null;
const CACHE_TTL = 10 * 60 * 1000;

// ─── Sources — one per stopwatch timezone ────────────────────────────────────
// Chosen for reliability + consistent image presence in their RSS feeds
const RSS_SOURCES = [
  {
    name   : 'CNBC',
    region : 'New York',
    url    : 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  },
  {
    name   : 'The Guardian',
    region : 'London',
    url    : 'https://www.theguardian.com/business/rss',
  },
  {
    name   : 'Al Jazeera',
    region : 'Doha',
    url    : 'https://www.aljazeera.com/xml/rss/all.xml',
  },
  {
    name   : 'BusinessDay',
    region : 'Lagos',
    url    : 'https://businessday.ng/feed/',
  },
  {
    name   : 'Nikkei Asia',
    region : 'Tokyo',
    url    : 'https://asia.nikkei.com/rss/feed/nar',
  },
];

// Browser-like headers so feeds don't block us
const REQUEST_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept'         : 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control'  : 'no-cache',
};

// ─── Image extractor — tries every known RSS image format in order ────────────
const extractImage = (itemXml) => {
  const checks = [
    // media:thumbnail url="..." — any URL, no extension required
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
    // media:content url="..."
    /<media:content[^>]+url=["']([^"']+)["']/i,
    // enclosure with image type
    /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i,
    /<enclosure[^>]+type=["']image[^>]+url=["']([^"']+)["']/i,
    // img src inside description/content
    /<img[^>]+src=["']([^"']+)["']/i,
    // any url= attribute whose value looks like an image CDN (no extension needed)
    /url=["'](https?:\/\/[^"']+(?:image|img|photo|thumb|media|picture)[^"']*?)["']/i,
    // last resort — any https URL containing common image path keywords
    /(https?:\/\/[^\s"'<>]*(?:image|img|photo|thumb|media)[^\s"'<>]*)/i,
  ];

  for (const pattern of checks) {
    const m = itemXml.match(pattern);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
  }

  return null;
};

// ─── RSS parser ───────────────────────────────────────────────────────────────
const parseRSS = (xml, source) => {
  const items     = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  const titleRx   = /<title>(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?<\/title>/;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const tMatch = titleRx.exec(block);
    if (!tMatch || !tMatch[1]) continue;

    const title = tMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!title) continue;

    const linkMatch = block.match(/<link>([^<]+)<\/link>/) || block.match(/<link[^>]+href=["']([^"']+)["']/i);
    items.push({
      title  : title,
      image  : extractImage(block),
      link   : linkMatch ? linkMatch[1].trim() : null,
      source : source.name,
      region : source.region,
    });
  }

  return items.slice(0, 3);
};

// ─── Fetch a single source ────────────────────────────────────────────────────
const fetchSource = async (source) => {
  const { data } = await axios.get(source.url, {
    timeout : 8000,
    headers : REQUEST_HEADERS,
  });

  return parseRSS(data, source);
};

// ─── Fetch & cache all sources ────────────────────────────────────────────────
const fetchAndCache = async () => {
  const now     = Date.now();
  const isFresh = newsCache.length > 0 && lastFetched && (now - lastFetched) < CACHE_TTL;
  if (isFresh) return newsCache;

  const results = [];

  for (const source of RSS_SOURCES) {
    try {
      const items = await fetchSource(source);
      results.push(...items);
      console.log(`✅ [${source.name}] ${items.length} items — images: ${items.filter(i => i.image).length}`);
    } catch (err) {
      console.error(`⚠️  [${source.name}] failed: ${err.message}`);
    }
  }

  if (results.length > 0) {
    newsCache   = results;
    lastFetched = now;
  }

  return newsCache;
};

// ─── GET /news ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const news = await fetchAndCache();

    if (!news.length) {
      return res.status(503).json({ success: false, message: 'News feed temporarily unavailable.' });
    }

    const idx  = Math.floor(Date.now() / 10_000) % news.length;
    const item = news[idx];

    return res.status(200).json({
      success : true,
      data    : {
        title  : item.title,
        image  : item.image,
        link   : item.link,
        source : item.source,
        region : item.region,
      },
      meta : { total: news.length, index: idx, cachedAt: lastFetched },
    });
  } catch (error) {
    console.error('News route error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /news/all ────────────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const news = await fetchAndCache();
    return res.status(200).json({
      success : true,
      data    : news,
      meta    : { total: news.length, cachedAt: lastFetched },
    });
  } catch (error) {
    console.error('News /all error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
