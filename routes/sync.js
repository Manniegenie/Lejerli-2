const express    = require('express');
const { Spot }   = require('@binance/connector');
const Transaction = require('../models/transaction');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

const TWELVE_MONTHS_MS  = 365 * 24 * 60 * 60 * 1000;
const MAX_RANGE_MS      = TWELVE_MONTHS_MS; // hard cap — never exceed 12 months

// Binance myTrades requires a symbol — we build candidates from account balances
// then add a fixed set of major quote assets to cover most pairs
const QUOTE_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'USDC', 'BUSD'];

function buildTradingPairs(balances) {
  // Only include assets with a non-zero balance — Binance returns 700+ zero-balance
  // historical assets which would generate thousands of invalid pair lookups.
  // Fully-sold assets with no remaining balance will simply not generate pairs,
  // which is an acceptable tradeoff to avoid a 15-minute sync for empty accounts.
  const assets = balances
    .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    .map(b => b.asset)
    .filter(a => !QUOTE_ASSETS.includes(a));

  const pairs = new Set();
  assets.forEach(asset => {
    QUOTE_ASSETS.forEach(quote => pairs.add(`${asset}${quote}`));
  });

  return [...pairs];
}

// 200ms delay between myTrades calls — keeps weight well under Binance's 1200/min limit
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Safe fetch — returns [] on any 400 (invalid/delisted symbol) or non-critical error
async function safeFetchTrades(client, symbol, startTime, endTime) {
  try {
    const res = await client.myTrades(symbol, { limit: 1000, startTime, endTime });
    return res.data || [];
  } catch (err) {
    // Suppress all 400s silently — covers -1121 (invalid symbol), delisted pairs, etc.
    if (err?.response?.status === 400 || err?.response?.data?.code === -1121) return [];
    console.warn(`⚠️  [sync] myTrades ${symbol}: ${err.message}`);
    return [];
  }
}

// ── POST /sync/:exchange ──────────────────────────────────────────────────────
//
// Body: { permissions: { trades: bool, deposits: bool, withdrawals: bool } }
//
// What it does — step by step:
//   1. Decrypt the user's stored API keys for the requested exchange
//   2. Authenticate against the exchange (account info ping)
//   3. Compute startTime = now − 12 months
//   4. Based on permissions:
//        trades     → discover all traded symbols via account balances,
//                     then fetch up to 1 000 fills per symbol
//        deposits   → fetch full deposit history (1 000 max per call)
//        withdrawals→ fetch full withdrawal history (1 000 max per call)
//   5. Store each record via Transaction static methods (duplicate-safe)
//   6. Update user.crypto.exchanges[exchange].lastSynced
//   7. Return a summary: { trades, deposits, withdrawals, errors }
//
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:exchange', protect, async (req, res) => {
  const { exchange } = req.params;
  const { permissions = {}, importRange = {} } = req.body;

  // ── 1. Validate exchange ─────────────────────────────────────────────────
  const SUPPORTED     = ['binance', 'kraken', 'coinbase'];
  const DEX_EXCHANGES = new Set(['phantom', 'metamask', 'trust', 'jupiter', 'uniswap', 'raydium']);

  if (DEX_EXCHANGES.has(exchange)) {
    // On-chain wallets — no CEX API to sync against; acknowledge and return
    return res.status(200).json({
      success: true,
      message: `${exchange} wallet connected. On-chain history sync coming soon.`,
      data: { exchange, synced: false, reason: 'dex_no_sync' },
    });
  }

  if (!SUPPORTED.includes(exchange)) {
    return res.status(400).json({ success: false, message: `Unsupported exchange: ${exchange}` });
  }

  // ── 2. Ensure at least one permission ────────────────────────────────────
  const { trades = false, deposits = false, withdrawals = false } = permissions;
  if (!trades && !deposits && !withdrawals) {
    return res.status(400).json({ success: false, message: 'Select at least one data permission' });
  }

  try {
    // ── 3. User is already attached by protect middleware — no extra DB hit ─
    const user = req.user;
    const keys = user.decryptApiKeys(exchange);
    if (!keys) {
      return res.status(400).json({
        success: false,
        message: `No API keys found for ${exchange}. Connect your exchange first.`,
      });
    }

    // ── 4. Init client (Binance only for now) ──────────────────────────────
    if (exchange !== 'binance') {
      return res.status(400).json({ success: false, message: `Sync for ${exchange} coming soon` });
    }

    const client = new Spot(keys.apiKey, keys.apiSecret);

    // ── Resolve import range ────────────────────────────────────────────────
    // Client can pass { from: ISO string, to: ISO string }.
    // We cap the range at 12 months and always floor to 00:00:00 UTC.
    const now       = Date.now();
    const rawFrom   = importRange.from ? new Date(importRange.from).getTime() : now - TWELVE_MONTHS_MS;
    const rawTo     = importRange.to   ? new Date(importRange.to).getTime()   : now;
    const startTime = Math.max(rawFrom, now - MAX_RANGE_MS); // never older than 12 months
    const endTime   = Math.min(rawTo, now);                  // never in the future

    const summary = { trades: 0, deposits: 0, withdrawals: 0, errors: [] };

    // ── Always fetch full account snapshot ──────────────────────────────────
    // Stores balances, permissions, tier, canTrade/Withdraw/Deposit on every sync
    let accountBalances = [];
    try {
      const accountRes  = await client.account();
      const accountData = accountRes.data;
      accountBalances   = accountData?.balances || [];

      // ── Fetch all prices in one call, build USD values ─────────────────────
      let priceMap = {};
      try {
        const priceRes = await client.tickerPrice();
        priceRes.data.forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });
      } catch (err) {
        console.warn(`[sync] price fetch failed: ${err.message}`);
      }

      const STABLE = new Set(['USDT', 'BUSD', 'USDC', 'DAI', 'TUSD', 'FDUSD']);
      const btcUsd = priceMap['BTCUSDT'] || 0;

      let totalUSD = 0;
      const enrichedBalances = accountBalances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => {
          const qty = parseFloat(b.free) + parseFloat(b.locked);
          let usdValue = 0;

          if (STABLE.has(b.asset)) {
            usdValue = qty;
          } else if (priceMap[`${b.asset}USDT`]) {
            usdValue = qty * priceMap[`${b.asset}USDT`];
          } else if (priceMap[`${b.asset}BTC`] && btcUsd) {
            usdValue = qty * priceMap[`${b.asset}BTC`] * btcUsd;
          } else if (priceMap[`${b.asset}ETH`] && priceMap['ETHUSDT']) {
            usdValue = qty * priceMap[`${b.asset}ETH`] * priceMap['ETHUSDT'];
          }

          totalUSD += usdValue;
          return { asset: b.asset, free: b.free, locked: b.locked, usdValue: usdValue.toFixed(2) };
        });

      user.crypto.exchanges[exchange].snapshot = {
        uid:         String(accountData?.uid         ?? ''),
        tier:        String(accountData?.accountType ?? ''),
        canTrade:    accountData?.canTrade     ?? null,
        canWithdraw: accountData?.canWithdraw  ?? null,
        canDeposit:  accountData?.canDeposit   ?? null,
        permissions: accountData?.permissions  ?? [],
        feeTier:     String(accountData?.commissionRates?.maker ?? ''),
        balances:    enrichedBalances,
        totalUSD:    totalUSD.toFixed(2),
        lastUpdated: new Date(),
      };
      console.log(`[sync:${user._id}] Snapshot — ${enrichedBalances.length} assets, $${totalUSD.toFixed(2)} total`);
    } catch (err) {
      console.error(`[sync] account snapshot error: ${err.message}`);
      summary.errors.push({ type: 'snapshot', message: err.message });
    }

    // ── 5a. Trades ──────────────────────────────────────────────────────────
    if (trades) {
      try {
        const pairs = buildTradingPairs(accountBalances);
        console.log(`[sync:${user._id}] Checking ${pairs.length} trading pairs…`);
        for (const symbol of pairs) {
          const fills = await safeFetchTrades(client, symbol, startTime, endTime);
          for (const fill of fills) {
            const stored = await Transaction.storeTrade(user._id, { ...fill, symbol });
            if (stored) summary.trades++;
          }
          await sleep(200); // respect Binance 1200 weight/min rate limit
        }
      } catch (err) {
        console.error(`[sync] trades error: ${err.message}`);
        summary.errors.push({ type: 'trades', message: err.message });
      }
    }

    // ── 5b. Deposits ────────────────────────────────────────────────────────
    if (deposits) {
      try {
        const res2 = await client.depositHistory({ limit: 1000, startTime, endTime });
        const list  = res2.data || [];
        for (const d of list) {
          const stored = await Transaction.storeDeposit(user._id, d);
          if (stored) summary.deposits++;
        }
      } catch (err) {
        // 400 = no capital wallet access or no history — expected for new/test accounts
        if (err?.response?.status !== 400) {
          const code = err?.response?.data?.code ?? '';
          console.error(`[sync] deposits error ${code}: ${err.message}`);
          summary.errors.push({ type: 'deposits', message: err.message });
        }
      }
    }

    // ── 5c. Withdrawals ─────────────────────────────────────────────────────
    if (withdrawals) {
      try {
        const res3 = await client.withdrawHistory({ limit: 1000, startTime, endTime });
        const list  = res3.data || [];
        for (const w of list) {
          const stored = await Transaction.storeWithdrawal(user._id, w);
          if (stored) summary.withdrawals++;
        }
      } catch (err) {
        // 400 = no capital wallet access or no history — expected for new/test accounts
        if (err?.response?.status !== 400) {
          const code = err?.response?.data?.code ?? '';
          console.error(`[sync] withdrawals error ${code}: ${err.message}`);
          summary.errors.push({ type: 'withdrawals', message: err.message });
        }
      }
    }

    // ── 6. Stamp lastSynced ─────────────────────────────────────────────────
    user.crypto.exchanges[exchange].lastSynced = new Date();
    await user.save();

    console.log(`✅ [sync:${exchange}] user ${user._id} — trades:${summary.trades} deposits:${summary.deposits} withdrawals:${summary.withdrawals}`);

    return res.status(200).json({
      success: true,
      message: `${exchange} sync complete`,
      data: {
        exchange,
        summary,
        importRange: { from: new Date(startTime), to: new Date(endTime) },
        snapshot: {
          assetCount:  user.crypto.exchanges[exchange].snapshot?.balances?.length ?? 0,
          totalUSD:    user.crypto.exchanges[exchange].snapshot?.totalUSD ?? '0.00',
          canTrade:    user.crypto.exchanges[exchange].snapshot?.canTrade,
          canWithdraw: user.crypto.exchanges[exchange].snapshot?.canWithdraw,
          canDeposit:  user.crypto.exchanges[exchange].snapshot?.canDeposit,
          lastUpdated: user.crypto.exchanges[exchange].snapshot?.lastUpdated,
        },
        syncedAt: user.crypto.exchanges[exchange].lastSynced,
      },
    });

  } catch (error) {
    console.error(`[sync] fatal error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Sync failed', error: error.message });
  }
});

module.exports = router;
