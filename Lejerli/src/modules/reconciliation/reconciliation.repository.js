'use strict';

const { ReconciliationRecord, RECON_STATUS } = require('./reconciliation.model');

async function findById(id) {
  return ReconciliationRecord.findById(id)
    .populate('cryptoTransactionId')
    .populate('fiatTransactionId')
    .lean();
}

async function findByCryptoTx(cryptoTransactionId) {
  return ReconciliationRecord.findOne({ cryptoTransactionId }).lean();
}

async function findByFiatTx(fiatTransactionId) {
  return ReconciliationRecord.findOne({ fiatTransactionId }).lean();
}

async function create(data) {
  const record = new ReconciliationRecord(data);
  return record.save();
}

async function updateStatus(id, status, resolvedBy, notes) {
  return ReconciliationRecord.findByIdAndUpdate(
    id,
    { status, resolvedBy: resolvedBy || null, notes },
    { new: true, runValidators: true }
  ).lean();
}

async function list({ page = 1, limit = 20, status } = {}) {
  const filter = {};
  if (status) filter.status = status;

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    ReconciliationRecord.find(filter)
      .populate('cryptoTransactionId', 'asset amount usdValue reference timestamp')
      .populate('fiatTransactionId', 'asset amount usdValue reference timestamp')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ReconciliationRecord.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

async function countByStatus() {
  return ReconciliationRecord.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
}

module.exports = {
  findById,
  findByCryptoTx,
  findByFiatTx,
  create,
  updateStatus,
  list,
  countByStatus,
};
