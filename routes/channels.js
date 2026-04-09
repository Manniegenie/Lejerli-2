const express    = require('express');
const { protect } = require('../middleware/auth');
const Tree       = require('../models/tree');

const router = express.Router();

const EXCHANGE_NAMES = { binance: 'Binance', kraken: 'Kraken', coinbase: 'Coinbase' };

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

  // ── CEX exchanges ────────────────────────────────────────────────────────
  const exchanges = user.crypto?.exchanges || {};
  for (const [id, ex] of Object.entries(exchanges)) {
    if (!ex.connected) continue;

    const snap     = ex.snapshot || {};
    const balances = (snap.balances || [])
      .filter(b => parseFloat(b.usdValue) > 0)
      .sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));

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
      lastSynced: ex.lastSynced  || null,
      connectedAt: ex.connectedAt || null,
      // Extra fields used by the Connected Accounts card
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
