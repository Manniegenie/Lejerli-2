'use strict';

const Decimal = require('decimal.js');
const txRepository = require('./transaction.repository');
const channelRepository = require('../channels/channel.repository');
const auditService = require('../audit/audit.service');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/**
 * Compute the USD value of a transaction using the channel's current rate.
 * If rateMode is MARKDOWN, applies markupPercentage on top of otcRate.
 */
function computeUsdValue(amount, channel) {
  if (!channel.otcRate) {
    throw new BadRequestError(`Channel "${channel.name}" has no OTC rate configured`);
  }

  const rate = new Decimal(channel.otcRate.toString());
  const amt = new Decimal(amount.toString());

  if (channel.rateMode === 'MARKDOWN' && channel.markupPercentage) {
    const markup = new Decimal(channel.markupPercentage).div(100).plus(1);
    return amt.mul(rate).mul(markup).toDecimalPlaces(8);
  }

  return amt.mul(rate).toDecimalPlaces(8);
}

async function createTransaction(data, requestingUserId) {
  const channel = await channelRepository.findById(data.channelId);
  if (!channel) throw new NotFoundError('Channel');
  if (!channel.isActive) throw new BadRequestError(`Channel "${channel.name}" is not active`);

  // Auto-compute USD value if not provided
  if (!data.usdValue) {
    data.usdValue = computeUsdValue(data.amount, channel).toString();
  }

  if (!data.rateAtExecution && channel.otcRate) {
    data.rateAtExecution = channel.otcRate.toString();
  }

  const tx = await txRepository.create(data);

  logger.info({ module: 'transactions', txId: tx._id, type: tx.type, direction: tx.direction }, 'Transaction created');

  await auditService.log({
    userId: requestingUserId,
    action: 'CREATE',
    entity: 'Transaction',
    entityId: tx._id,
    newValue: { type: tx.type, amount: data.amount, usdValue: data.usdValue, status: tx.status },
  });

  return tx;
}

async function getTransactionById(id) {
  const tx = await txRepository.findById(id);
  if (!tx) throw new NotFoundError('Transaction');
  return tx;
}

async function listTransactions(filters) {
  return txRepository.list(filters);
}

async function updateTransactionStatus(id, status, note, requestingUserId) {
  const existing = await txRepository.findById(id);
  if (!existing) throw new NotFoundError('Transaction');

  const updated = await txRepository.updateStatus(id, status, note);

  logger.info({ module: 'transactions', txId: id, status }, 'Transaction status updated');

  await auditService.log({
    userId: requestingUserId,
    action: 'STATUS_UPDATE',
    entity: 'Transaction',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status },
  });

  return updated;
}

async function getVolumeAnalytics(filters) {
  return txRepository.volumeByChannel(filters);
}

module.exports = {
  createTransaction,
  getTransactionById,
  listTransactions,
  updateTransactionStatus,
  getVolumeAnalytics,
  computeUsdValue,
};
