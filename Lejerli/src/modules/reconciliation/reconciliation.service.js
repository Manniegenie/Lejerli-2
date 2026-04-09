'use strict';

const Decimal = require('decimal.js');
const reconRepository = require('./reconciliation.repository');
const txRepository = require('../transactions/transaction.repository');
const auditService = require('../audit/audit.service');
const { broadcast } = require('../../infrastructure/websocket/ws');
const { TX_STATUS } = require('../transactions/transaction.model');
const { RECON_STATUS } = require('./reconciliation.model');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const config = require('../../config');
const logger = require('../../utils/logger');

const WS_ROOM = 'reconciliation';

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  RECONCILIATION ENGINE — Core Scaffold
 *
 *  Architecture:
 *    1. matchTransactions() — the main engine loop (run by cron job)
 *    2. scoreMatch()        — internal scoring heuristic (placeholder)
 *    3. applyMatch()        — persists a confirmed match
 *    4. flagForManual()     — sends low-confidence matches to ops queue
 *    5. getStats()          — reconciliation dashboard statistics
 *
 *  Tolerance Rule:
 *    abs(crypto.usdValue - fiat.usdValue) <= toleranceUsd
 *
 *  Match Score Components (scaffold — implement fully in Phase 2):
 *    - USD value proximity   (weight: 60%)
 *    - Timestamp proximity   (weight: 25%)
 *    - Reference correlation (weight: 15%)
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * scoreMatch — placeholder scoring function.
 *
 * @param {object} cryptoTx
 * @param {object} fiatTx
 * @param {number} toleranceUsd
 * @returns {number} score 0–100
 *
 * TODO (Phase 2): Implement full ML-assisted scoring.
 */
function scoreMatch(cryptoTx, fiatTx, toleranceUsd) {
  const cryptoUsd = new Decimal(cryptoTx.usdValue.toString());
  const fiatUsd = new Decimal(fiatTx.usdValue.toString());
  const diff = cryptoUsd.minus(fiatUsd).abs();

  if (diff.greaterThan(toleranceUsd)) return 0;

  // Simple linear score: perfect match = 100, tolerance boundary = 50
  const usdScore = diff.eq(0)
    ? 100
    : new Decimal(1).minus(diff.div(toleranceUsd)).mul(50).plus(50).toNumber();

  // TODO: factor in timestamp proximity and reference correlation
  return Math.round(usdScore);
}

/**
 * matchTransactions — the reconciliation engine's main entry point.
 *
 * Flow:
 *  1. Fetch batch of unmatched crypto transactions (PENDING)
 *  2. For each crypto tx, fetch candidate fiat transactions within a time window
 *  3. Apply tolerance rule to filter candidates
 *  4. Score remaining candidates
 *  5. Best-score above threshold → AUTO_MATCHED
 *  6. Score in grey zone → FLAGGED for manual review
 *  7. No candidates → remain PENDING
 *
 * @returns {object} { matched, flagged, skipped, errors }
 */
async function matchTransactions() {
  const toleranceUsd = config.reconciliation.toleranceUsd;
  const batchSize = config.reconciliation.batchSize;

  logger.info({ module: 'recon', toleranceUsd, batchSize }, 'Reconciliation run started');

  const results = { matched: 0, flagged: 0, skipped: 0, errors: 0 };

  let unmatchedCryptoTxs;
  try {
    unmatchedCryptoTxs = await txRepository.findUnmatchedCrypto({ limit: batchSize });
  } catch (err) {
    logger.error({ module: 'recon', err }, 'Failed to fetch unmatched crypto transactions');
    return results;
  }

  logger.info({ module: 'recon', count: unmatchedCryptoTxs.length }, 'Crypto transactions to process');

  for (const cryptoTx of unmatchedCryptoTxs) {
    try {
      // Define a ±24h time window around the crypto tx timestamp
      const fromTs = new Date(new Date(cryptoTx.timestamp).getTime() - 24 * 60 * 60 * 1000);
      const toTs   = new Date(new Date(cryptoTx.timestamp).getTime() + 24 * 60 * 60 * 1000);

      const candidateFiatTxs = await txRepository.findCandidateFiat({ fromTs, toTs });

      // ── Apply tolerance filter ──────────────────────────────────────────
      const withinTolerance = candidateFiatTxs.filter((fiatTx) => {
        const diff = Math.abs(
          parseFloat(cryptoTx.usdValue.toString()) -
          parseFloat(fiatTx.usdValue.toString())
        );
        return diff <= toleranceUsd;
      });

      if (withinTolerance.length === 0) {
        results.skipped += 1;
        continue;
      }

      // ── Score and find best candidate ──────────────────────────────────
      const scored = withinTolerance
        .map((fiatTx) => ({ fiatTx, score: scoreMatch(cryptoTx, fiatTx, toleranceUsd) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];

      // Check if this fiat tx is already matched
      const existingMatch = await reconRepository.findByFiatTx(best.fiatTx._id);
      if (existingMatch) {
        results.skipped += 1;
        continue;
      }

      if (best.score >= 80) {
        // High confidence → auto match
        await applyMatch(cryptoTx, best.fiatTx, best.score, toleranceUsd, RECON_STATUS.AUTO_MATCHED);
        results.matched += 1;
      } else if (best.score >= 40) {
        // Low confidence → flag for manual review
        await applyMatch(cryptoTx, best.fiatTx, best.score, toleranceUsd, RECON_STATUS.FLAGGED);
        results.flagged += 1;
      } else {
        results.skipped += 1;
      }
    } catch (err) {
      logger.error({ module: 'recon', txId: cryptoTx._id, err }, 'Error processing crypto tx in reconciliation');
      results.errors += 1;
    }
  }

  logger.info({ module: 'recon', results }, 'Reconciliation run completed');

  // Broadcast results to ops dashboard via WebSocket
  broadcast(WS_ROOM, 'RECON_RUN_COMPLETE', { ...results, ts: Date.now() });

  return results;
}

/**
 * applyMatch — persists a reconciliation record and updates both transactions.
 * @private
 */
async function applyMatch(cryptoTx, fiatTx, score, toleranceUsd, status) {
  // Create reconciliation record
  await reconRepository.create({
    cryptoTransactionId: cryptoTx._id,
    fiatTransactionId: fiatTx._id,
    matchScore: score,
    toleranceUsed: toleranceUsd,
    status,
  });

  const newTxStatus = status === RECON_STATUS.AUTO_MATCHED ? TX_STATUS.MATCHED : TX_STATUS.PARTIAL;

  // Update both transaction statuses
  await txRepository.updateStatus(cryptoTx._id, newTxStatus, `Reconciliation ${status}`);
  await txRepository.updateStatus(fiatTx._id, newTxStatus, `Reconciliation ${status}`);

  await auditService.log({
    action: status === RECON_STATUS.AUTO_MATCHED ? 'RECON_AUTO_MATCH' : 'RECON_FLAGGED',
    entity: 'ReconciliationRecord',
    entityId: cryptoTx._id,
    newValue: { cryptoTxId: cryptoTx._id, fiatTxId: fiatTx._id, score, status },
  });

  broadcast(WS_ROOM, 'RECON_MATCH', {
    cryptoTxId: cryptoTx._id,
    fiatTxId: fiatTx._id,
    score,
    status,
  });

  logger.info({ module: 'recon', cryptoTxId: cryptoTx._id, fiatTxId: fiatTx._id, score, status }, 'Match applied');
}

/**
 * manualMatch — OPS/ADMIN overrides a match.
 */
async function manualMatch(reconId, requestingUserId) {
  const record = await reconRepository.findById(reconId);
  if (!record) throw new NotFoundError('ReconciliationRecord');

  if (record.status === RECON_STATUS.MANUAL_MATCHED) {
    throw new BadRequestError('Already manually matched');
  }

  const updated = await reconRepository.updateStatus(
    reconId,
    RECON_STATUS.MANUAL_MATCHED,
    requestingUserId,
    'Manually confirmed by ops'
  );

  // Ensure both transactions are MATCHED
  await txRepository.updateStatus(record.cryptoTransactionId._id || record.cryptoTransactionId, TX_STATUS.MATCHED, 'Manual reconciliation');
  await txRepository.updateStatus(record.fiatTransactionId._id || record.fiatTransactionId, TX_STATUS.MATCHED, 'Manual reconciliation');

  await auditService.log({
    userId: requestingUserId,
    action: 'RECON_MANUAL_MATCH',
    entity: 'ReconciliationRecord',
    entityId: reconId,
    oldValue: { status: record.status },
    newValue: { status: RECON_STATUS.MANUAL_MATCHED },
  });

  broadcast(WS_ROOM, 'RECON_MANUAL_MATCH', { reconId, resolvedBy: requestingUserId });

  return updated;
}

async function listRecords(filters) {
  return reconRepository.list(filters);
}

async function getStats() {
  const counts = await reconRepository.countByStatus();
  const stats = { AUTO_MATCHED: 0, MANUAL_MATCHED: 0, FLAGGED: 0 };
  counts.forEach(({ _id, count }) => { stats[_id] = count; });
  return stats;
}

module.exports = {
  matchTransactions,
  manualMatch,
  listRecords,
  getStats,
};
