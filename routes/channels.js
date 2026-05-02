const express    = require('express');
const { protect } = require('../middleware/auth');
const Tree       = require('../models/tree');
const { fetchBalancesWithUSD: fetchSolanaBalances }  = require('./phantom');
const { fetchBalancesWithUSD: fetchEthBalances    }  = require('./ethereum');
const { fetchAccountsWithUSD: fetchCoinbaseBalances } = require('./coinbase');
const { fetchAccountsWithUSD: fetchBybitBalances    } = require('./bybit');

const router = express.Router();

const EXCHANGE_NAMES = {
  binance: 'Binance', kraken: 'Kraken', coinbase: 'Coinbase', bybit_spot: 'Bybit',
};

const DEX_CHAIN = {
  phantom: 'solana', jupiter: 'solana', raydium: 'solana',
  metamask: 'ethereum', uniswap: 'ethereum',
  trust: 'multi',
};

const DEX_DISPLAY = {
  phantom: 'Phantom', jupiter: 'Jupiter', raydium: 'Raydium',
  metamask: 'MetaMask', uniswap: 'Uniswap', trust: 'Trust Wallet',
};

// Native asset shown even when wallet balance is zero
const DEX_NATIVE_ASSET = {
  phantom: 'SOL', jupiter: 'SOL', raydium: 'SOL',
  metamask: 'ETH', uniswap: 'ETH',
  trust: 'Multi',
};

function fmtUSD(raw) {
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── GET /channels ─────────────────────────────────────────────────────────────
// Returns one row per connected source (CEX exchange, BSC wallet, Mono account).
// Shape matches the ChannelRow type on the frontend.

router.get('/', protect, async (req, res) => {
  const user = req.user;
  const rows = [];

  // Build a map of channelId → avg margin across all trees for this user
  const trees = await Tree.find({ userId: user._id }).lean();
  const channelMarginMap = {};
  for (const tree of trees) {
    if (!tree.assets.length) continue;
    const avg = tree.assets.reduce((s, a) => s + a.margin, 0) / tree.assets.length;
    if (channelMarginMap[tree.channelId] === undefined) {
      channelMarginMap[tree.channelId] = { sum: 0, count: 0 };
    }
    channelMarginMap[tree.channelId].sum   += avg;
    channelMarginMap[tree.channelId].count += 1;
  }
  const getMargin = (id) => {
    const entry = channelMarginMap[id];
    if (!entry) return '—';
    return (entry.sum / entry.count).toFixed(1) + '%';
  };

  // ── CEX + DEX exchanges ──────────────────────────────────────────────────
  const exchanges = user.crypto?.exchanges || {};
  for (const [id, ex] of Object.entries(exchanges)) {
    if (!ex.connected) continue;

    const isDex   = id in DEX_CHAIN;
    const chain   = DEX_CHAIN[id];

    // ── DEX on-chain wallet ──────────────────────────────────────────────
    if (isDex) {
      let walletAddress = '—';
      let balances      = [];
      let totalUSD      = 0;

      try {
        const keys = user.decryptApiKeys(id);
        if (keys?.apiKey) {
          walletAddress = keys.apiKey;
          if (chain === 'solana') {
            balances = await fetchSolanaBalances(walletAddress);
          } else if (chain === 'ethereum') {
            balances = await fetchEthBalances(walletAddress);
          }
          totalUSD = balances.reduce((s, b) => s + parseFloat(b.usdValue || '0'), 0);
        }
      } catch (_) {}

      const addrShort = walletAddress !== '—'
        ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
        : '—';
      const topAssets = balances.length
        ? balances.slice(0, 3).map(b => b.asset).join(' / ')
        : (DEX_NATIVE_ASSET[id] || '—');

      rows.push({
        id,
        channel:     DEX_DISPLAY[id] || id,
        type:        'DEX',
        assets:      topAssets,
        connection:  'On-Chain',
        balance:     totalUSD > 0 ? fmtUSD(totalUSD.toFixed(2)) : '—',
        mode:        'Read Only',
        margin:      getMargin(id),
        status:      'Active',
        lastSynced:  ex.lastSynced  || null,
        connectedAt: ex.connectedAt || null,
        walletAddress: addrShort,
        snapshot: {
          totalUSD:    totalUSD > 0 ? totalUSD.toFixed(2) : null,
          assetCount:  balances.length,
          canTrade:    false,
          lastUpdated: new Date(),
        },
      });
      continue;
    }

    // ── CEX exchange ─────────────────────────────────────────────────────
    let snap     = ex.snapshot || {};
    let balances = (snap.balances || [])
      .filter(b => parseFloat(b.usdValue) > 0)
      .sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));

    // Live-fetch if snapshot is empty (e.g. freshly connected, no sync yet)
    if (!balances.length) {
      try {
        const keys = user.decryptApiKeys(id);
        if (keys?.apiKey && keys?.apiSecret) {
          let liveBalances = [];

          if (id === 'binance') {
            const { Spot } = require('@binance/connector');
            const client   = new Spot(keys.apiKey, keys.apiSecret);
            const [acctRes, priceRes] = await Promise.all([client.account(), client.tickerPrice()]);
            const priceMap = {};
            priceRes.data.forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });
            const STABLE = new Set(['USDT','BUSD','USDC','DAI','TUSD','FDUSD']);
            const btcUsd = priceMap['BTCUSDT'] || 0;
            liveBalances = acctRes.data.balances
              .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
              .map(b => {
                const qty = parseFloat(b.free) + parseFloat(b.locked);
                let usdValue = 0;
                if (STABLE.has(b.asset))                      usdValue = qty;
                else if (priceMap[`${b.asset}USDT`])          usdValue = qty * priceMap[`${b.asset}USDT`];
                else if (priceMap[`${b.asset}BTC`] && btcUsd) usdValue = qty * priceMap[`${b.asset}BTC`] * btcUsd;
                return { asset: b.asset, free: b.free, locked: b.locked, usdValue: usdValue.toFixed(2) };
              });
            snap = { ...snap, canTrade: acctRes.data.canTrade };
          } else if (id === 'coinbase') {
            liveBalances = await fetchCoinbaseBalances(keys.apiKey, keys.apiSecret);
          } else if (id === 'bybit_spot') {
            liveBalances = await fetchBybitBalances(keys.apiKey, keys.apiSecret);
          } else if (id === 'kraken') {
            const krakenService = require('../services/kraken');
            krakenService.connect(keys.apiKey, keys.apiSecret);
            const krakenBalances = await krakenService.getAccountBalance();
            liveBalances = Object.entries(krakenBalances)
              .filter(([, qty]) => parseFloat(qty) > 0)
              .map(([asset, qty]) => ({ asset, free: qty, locked: '0', usdValue: '0' }));
          }

          balances = liveBalances
            .filter(b => parseFloat(b.usdValue ?? b.free) > 0)
            .sort((a, b) => parseFloat(b.usdValue || '0') - parseFloat(a.usdValue || '0'));

          const liveTotal = balances.reduce((s, b) => s + parseFloat(b.usdValue || '0'), 0);
          if (liveTotal > 0) snap = { ...snap, totalUSD: liveTotal.toFixed(2) };
        }
      } catch (_) {}
    }

    const topAssets = balances.length
      ? balances.slice(0, 3).map(b => b.asset).join(' / ')
      : '—';

    rows.push({
      id,
      channel:    EXCHANGE_NAMES[id] || id,
      type:       'Crypto',
      assets:     topAssets,
      connection: 'API',
      balance:    snap.totalUSD ? fmtUSD(snap.totalUSD) : '—',
      mode:       snap.canTrade === true ? 'Active' : snap.canTrade === false ? 'Read Only' : '—',
      margin:     getMargin(id),
      status:     'Active',
      lastSynced:  ex.lastSynced  || null,
      connectedAt: ex.connectedAt || null,
      snapshot: {
        totalUSD:    snap.totalUSD    || null,
        assetCount:  balances.length,
        canTrade:    snap.canTrade    ?? null,
        lastUpdated: snap.lastUpdated || null,
      },
    });
  }

  // ── BSC on-chain wallet ──────────────────────────────────────────────────
  const bsc = user.crypto?.onChain?.bsc;
  if (bsc?.connected) {
    const snap   = bsc.snapshot || {};
    const tokens = bsc.tokens   || [];

    const topTokens = tokens
      .filter(t => parseFloat(t.balanceUSD || '0') > 0)
      .sort((a, b) => parseFloat(b.balanceUSD || '0') - parseFloat(a.balanceUSD || '0'))
      .slice(0, 2)
      .map(t => t.symbol);

    const assetStr = ['BNB', ...topTokens].join(' / ');
    const addr     = bsc.walletAddress || '';
    const addrShort = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'BSC Wallet';

    rows.push({
      id:         'bsc',
      channel:    addrShort,
      type:       'Crypto',
      assets:     assetStr,
      connection: 'On-Chain',
      balance:    snap.bnbBalanceUSD ? fmtUSD(snap.bnbBalanceUSD) : '—',
      mode:       'Read Only',
      margin:     getMargin('bsc'),
      status:     'Active',
      lastSynced:  bsc.lastSynced  || null,
      connectedAt: bsc.connectedAt || null,
      snapshot:    null,
    });
  }

  // ── Mono fiat accounts ───────────────────────────────────────────────────
  const mono = user.fiat?.mono;
  if (mono?.connected) {
    for (const acc of mono.accounts || []) {
      const balanceKobo = acc.balance != null ? acc.balance / 100 : null;
      const balanceFmt  = balanceKobo != null
        ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: acc.currency || 'NGN', maximumFractionDigits: 2 }).format(balanceKobo)
        : '—';

      rows.push({
        id:         `mono_${acc.monoAccountId || acc.accountNumber}`,
        channel:    acc.institution?.name || 'Bank Account',
        type:       'Fiat',
        assets:     [acc.currency, acc.accountType].filter(Boolean).join(' / ') || '—',
        connection: 'API',
        balance:    balanceFmt,
        mode:       'Active',
        margin:     getMargin(`mono_${acc.monoAccountId || acc.accountNumber}`),
        status:     acc.status === 'active' ? 'Active' : 'Inactive',
        lastSynced:  mono.lastSynced  || null,
        connectedAt: mono.connectedAt || null,
        snapshot:    null,
      });
    }
  }

  return res.status(200).json({ success: true, data: rows });
});

module.exports = router;
