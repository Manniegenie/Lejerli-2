/**
 * Balance Poller — runs every 5 minutes
 *
 * Checks every Binance-connected user for balance changes.
 * Users are processed sequentially with a 2-second gap between each,
 * keeping API weight well under Binance's 1200/min limit:
 *
 *   account()       = weight 20
 *   tickerPrice()   = weight 4  (only called when balances changed)
 *   2s gap between users = max 30 users/min = 600 weight/min (50% headroom)
 *
 * On change: updates user.crypto.exchanges.binance.snapshot in MongoDB.
 */

const cron    = require('node-cron');
const { Spot } = require('@binance/connector');
const User    = require('../models/user');
const Tree    = require('../models/tree');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const STABLE  = new Set(['USDT','BUSD','USDC','DAI','TUSD','FDUSD']);
const POLL_INTERVAL_SEC  = 5 * 60;   // desired gap between polls per user
const USER_GAP_MS        = 2_000;    // delay between successive user checks

// ── Core check for a single user ─────────────────────────────────────────────

async function checkUser(user) {
  const ex   = user.crypto?.exchanges?.binance;
  if (!ex?.connected) return;

  const keys = user.decryptApiKeys('binance');
  if (!keys)  return;

  try {
    const client     = new Spot(keys.apiKey, keys.apiSecret);
    const accountRes = await client.account();
    const rawBalances = accountRes.data?.balances || [];

    // Filter to assets with any balance
    const live = rawBalances.filter(b =>
      parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );

    // Compare with stored snapshot
    const stored      = ex.snapshot?.balances || [];
    const storedMap   = Object.fromEntries(stored.map(b => [b.asset, b]));
    const liveAssets  = new Set(live.map(b => b.asset));
    const storedAssets = new Set(stored.map(b => b.asset));

    const newAssets  = live.filter(b => !storedAssets.has(b.asset));
    const goneAssets = stored.filter(b => !liveAssets.has(b.asset));
    const changed    = live.filter(b => {
      const prev = storedMap[b.asset];
      return prev && (prev.free !== b.free || prev.locked !== b.locked);
    });

    const hasChange = newAssets.length > 0 || goneAssets.length > 0 || changed.length > 0;
    if (!hasChange) return; // nothing to do

    // Log what changed
    if (newAssets.length)  console.log(`[poller:${user._id}] +${newAssets.length} new asset(s): ${newAssets.map(b => b.asset).join(', ')}`);
    if (goneAssets.length) console.log(`[poller:${user._id}] -${goneAssets.length} gone asset(s): ${goneAssets.map(b => b.asset).join(', ')}`);
    if (changed.length)    console.log(`[poller:${user._id}] ~${changed.length} balance change(s): ${changed.map(b => b.asset).join(', ')}`);

    // Fetch prices to recompute USD values
    let priceMap = {};
    try {
      const priceRes = await client.tickerPrice();
      priceRes.data.forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });
    } catch (_) {}

    const btcUsd = priceMap['BTCUSDT'] || 0;

    let totalUSD = 0;
    const enriched = live.map(b => {
      const qty = parseFloat(b.free) + parseFloat(b.locked);
      let usdValue = 0;
      if      (STABLE.has(b.asset))                                       usdValue = qty;
      else if (priceMap[`${b.asset}USDT`])                                usdValue = qty * priceMap[`${b.asset}USDT`];
      else if (priceMap[`${b.asset}BTC`] && btcUsd)                       usdValue = qty * priceMap[`${b.asset}BTC`] * btcUsd;
      else if (priceMap[`${b.asset}ETH`] && priceMap['ETHUSDT'])
        usdValue = qty * priceMap[`${b.asset}ETH`] * priceMap['ETHUSDT'];
      totalUSD += usdValue;
      return { asset: b.asset, free: b.free, locked: b.locked, usdValue: usdValue.toFixed(2) };
    });

    // ── Profit-Net: accumulate realized profit for deposit events ────────────
    // Build list of deposit events: new assets (full qty) + balance increases (delta qty)
    const depositEvents = [
      ...newAssets.map(b => ({
        asset: b.asset,
        qty:   parseFloat(b.free) + parseFloat(b.locked),
      })),
      ...changed
        .filter(b => {
          const prev    = storedMap[b.asset];
          const prevQty = parseFloat(prev.free) + parseFloat(prev.locked);
          const newQty  = parseFloat(b.free)    + parseFloat(b.locked);
          return newQty > prevQty;
        })
        .map(b => {
          const prev    = storedMap[b.asset];
          const prevQty = parseFloat(prev.free) + parseFloat(prev.locked);
          const newQty  = parseFloat(b.free)    + parseFloat(b.locked);
          return { asset: b.asset, qty: newQty - prevQty };
        }),
    ];

    if (depositEvents.length > 0) {
      const trees = await Tree.find({ userId: user._id, channelId: 'binance' });
      for (const tree of trees) {
        let increment = 0;
        for (const dep of depositEvents) {
          const treeAsset = tree.assets.find(a => a.asset === dep.asset);
          if (!treeAsset) continue;
          const actualPrice = STABLE.has(dep.asset) ? 1 : (priceMap[`${dep.asset}USDT`] || 0);
          increment += (actualPrice - treeAsset.entryPrice) * dep.qty;
        }
        if (increment !== 0) {
          tree.profitNet = (tree.profitNet || 0) + increment;
          await tree.save();
          console.log(`[poller:${user._id}] tree ${tree._id} profitNet updated +${increment.toFixed(4)}`);
        }
      }
    }

    // Update snapshot
    user.crypto.exchanges.binance.snapshot.balances    = enriched;
    user.crypto.exchanges.binance.snapshot.totalUSD    = totalUSD.toFixed(2);
    user.crypto.exchanges.binance.snapshot.lastUpdated = new Date();
    user.markModified('crypto.exchanges.binance.snapshot');
    await user.save();

    console.log(`✅ [poller:${user._id}] snapshot updated — ${enriched.length} assets, $${totalUSD.toFixed(2)}`);
  } catch (err) {
    // Silently skip — invalid keys, network error, etc.
    if (err?.response?.data?.code !== -1121) {
      console.warn(`[poller:${user._id}] check failed: ${err.message}`);
    }
  }
}

// ── Cron job ─────────────────────────────────────────────────────────────────

function start() {
  // Every 5 minutes — process all connected users sequentially
  cron.schedule('*/5 * * * *', async () => {
    console.log('[poller] Starting balance poll cycle…');

    let users;
    try {
      users = await User.find({ 'crypto.exchanges.binance.connected': true }).lean(false);
    } catch (err) {
      console.error('[poller] DB query failed:', err.message);
      return;
    }

    if (!users.length) {
      console.log('[poller] No connected users — skipping.');
      return;
    }

    console.log(`[poller] Checking ${users.length} user(s) with ${USER_GAP_MS}ms gap…`);

    for (const user of users) {
      await checkUser(user);
      await sleep(USER_GAP_MS);
    }

    console.log('[poller] Cycle complete.');
  });

  console.log('✅ Balance poller scheduled (every 5 min, 2s/user gap)');
}

module.exports = { start };
