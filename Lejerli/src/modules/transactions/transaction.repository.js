'use strict';

const { Transaction, TX_STATUS, TX_TYPE } = require('./transaction.model');

async function findById(id) {
  return Transaction.findById(id).populate('channelId', 'name type asset currency').lean();
}

async function findByReference(reference) {
  return Transaction.findOne({ reference }).lean();
}

async function create(data) {
  const tx = new Transaction(data);
  return tx.save();
}

async function updateStatus(id, status, note) {
  const tx = await Transaction.findById(id);
  if (!tx) return null;
  tx.status = status;
  if (note) tx.statusHistory.push({ status, changedAt: new Date(), note });
  return tx.save();
}

async function updateById(id, updates) {
  return Transaction.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  }).lean();
}

/**
 * Fetch unmatched crypto transactions for reconciliation engine.
 * Sorted by timestamp ASC so oldest are processed first.
 */
async function findUnmatchedCrypto({ limit = 100, before } = {}) {
  const filter = {
    type: TX_TYPE.CRYPTO,
    status: TX_STATUS.PENDING,
  };
  if (before) filter.timestamp = { $lte: before };

  return Transaction.find(filter)
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();
}

/**
 * Fetch candidate fiat transactions for reconciliation matching.
 * Typically fetches those within a time window around the crypto tx.
 */
async function findCandidateFiat({ fromTs, toTs, limit = 200 } = {}) {
  const filter = {
    type: TX_TYPE.FIAT,
    status: { $in: [TX_STATUS.PENDING, TX_STATUS.UNMATCHED] },
  };

  if (fromTs || toTs) {
    filter.timestamp = {};
    if (fromTs) filter.timestamp.$gte = fromTs;
    if (toTs) filter.timestamp.$lte = toTs;
  }

  return Transaction.find(filter).sort({ timestamp: 1 }).limit(limit).lean();
}

async function list({
  page = 1,
  limit = 20,
  channelId,
  type,
  direction,
  status,
  fromDate,
  toDate,
} = {}) {
  const filter = {};
  if (channelId) filter.channelId = channelId;
  if (type) filter.type = type;
  if (direction) filter.direction = direction;
  if (status) filter.status = status;
  if (fromDate || toDate) {
    filter.timestamp = {};
    if (fromDate) filter.timestamp.$gte = new Date(fromDate);
    if (toDate) filter.timestamp.$lte = new Date(toDate);
  }

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Transaction.find(filter)
      .populate('channelId', 'name type asset currency')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

/**
 * Aggregate USD volume by channel for analytics.
 */
async function volumeByChannel({ fromDate, toDate } = {}) {
  const match = {};
  if (fromDate || toDate) {
    match.timestamp = {};
    if (fromDate) match.timestamp.$gte = new Date(fromDate);
    if (toDate) match.timestamp.$lte = new Date(toDate);
  }

  return Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { channelId: '$channelId', direction: '$direction' },
        totalUsd: { $sum: { $toDouble: '$usdValue' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalUsd: -1 } },
  ]);
}

module.exports = {
  findById,
  findByReference,
  create,
  updateStatus,
  updateById,
  findUnmatchedCrypto,
  findCandidateFiat,
  list,
  volumeByChannel,
};
