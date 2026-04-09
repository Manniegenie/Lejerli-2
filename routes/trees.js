const express    = require('express');
const { protect } = require('../middleware/auth');
const Tree        = require('../models/tree');

const router = express.Router();

// ── POST /trees ───────────────────────────────────────────────────────────────
// Body: { channelId, assets: [{ asset, margin, priceAtCreation }] }
router.post('/', protect, async (req, res) => {
  const { channelId, assets = [], name } = req.body;

  if (!channelId) return res.status(400).json({ success: false, message: 'channelId is required' });
  if (!assets.length) return res.status(400).json({ success: false, message: 'Select at least one asset' });

  const rows = assets.map(a => {
    const margin          = parseFloat(a.margin) || 0;
    const priceAtCreation = parseFloat(a.priceAtCreation) || 0;
    const entryPrice      = priceAtCreation * (1 - margin / 100);
    const profitGross     = priceAtCreation * (margin / 100);
    return { asset: a.asset, margin, priceAtCreation, entryPrice, profitGross };
  });

  const totalProfitGross = rows.reduce((s, r) => s + r.profitGross, 0);

  try {
    const tree = await Tree.create({
      userId:    req.user._id,
      channelId,
      name:      name || null,
      assets:    rows,
      totalProfitGross,
    });

    return res.status(201).json({
      success: true,
      message: 'Tree created',
      data: tree,
    });
  } catch (err) {
    console.error('[trees] create error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create tree', error: err.message });
  }
});

// ── GET /trees ────────────────────────────────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const trees = await Tree.find({ userId: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: trees });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /trees/:id ────────────────────────────────────────────────────────────
router.put('/:id', protect, async (req, res) => {
  const { channelId, assets = [], name } = req.body;

  try {
    const tree = await Tree.findOne({ _id: req.params.id, userId: req.user._id });
    if (!tree) return res.status(404).json({ success: false, message: 'Tree not found' });

    if (channelId) tree.channelId = channelId;
    if (name !== undefined) tree.name = name || null;

    if (assets.length) {
      const rows = assets.map(a => {
        const margin          = parseFloat(a.margin) || 0;
        const priceAtCreation = parseFloat(a.priceAtCreation) || 0;
        const entryPrice      = priceAtCreation * (1 - margin / 100);
        const profitGross     = priceAtCreation * (margin / 100);
        return { asset: a.asset, margin, priceAtCreation, entryPrice, profitGross };
      });
      tree.assets = rows;
      tree.totalProfitGross = rows.reduce((s, r) => s + r.profitGross, 0);
    }

    await tree.save();
    return res.status(200).json({ success: true, message: 'Tree updated', data: tree });
  } catch (err) {
    console.error('[trees] update error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
