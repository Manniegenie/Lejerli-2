'use strict';

/**
 * Unit tests for ReconciliationService — matchTransactions engine.
 */

jest.mock('../../../src/modules/transactions/transaction.repository');
jest.mock('../../../src/modules/reconciliation/reconciliation.repository');
jest.mock('../../../src/modules/audit/audit.service');
jest.mock('../../../src/infrastructure/websocket/ws', () => ({
  broadcast: jest.fn(),
}));

const reconService = require('../../../src/modules/reconciliation/reconciliation.service');
const txRepo = require('../../../src/modules/transactions/transaction.repository');
const reconRepo = require('../../../src/modules/reconciliation/reconciliation.repository');
const { RECON_STATUS } = require('../../../src/modules/reconciliation/reconciliation.model');
const { TX_STATUS } = require('../../../src/modules/transactions/transaction.model');

// ── Fixtures ──────────────────────────────────────────────────────────────

const makeTx = (id, type, usdValue, status = 'PENDING') => ({
  _id: id,
  type,
  usdValue: { toString: () => String(usdValue) },
  amount: { toString: () => '1' },
  timestamp: new Date('2024-01-01T12:00:00Z'),
  status,
  reference: `REF-${id}`,
});

// ── matchTransactions ─────────────────────────────────────────────────────

describe('matchTransactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('auto-matches when USD diff is within tolerance and score >= 80', async () => {
    const cryptoTx = makeTx('c001', 'CRYPTO', 1000);
    const fiatTx   = makeTx('f001', 'FIAT',   1000.50);

    txRepo.findUnmatchedCrypto.mockResolvedValue([cryptoTx]);
    txRepo.findCandidateFiat.mockResolvedValue([fiatTx]);
    reconRepo.findByFiatTx.mockResolvedValue(null); // not yet matched
    reconRepo.create.mockResolvedValue({});
    txRepo.updateStatus.mockResolvedValue({});

    const results = await reconService.matchTransactions();

    expect(results.matched).toBe(1);
    expect(results.flagged).toBe(0);
    expect(reconRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: RECON_STATUS.AUTO_MATCHED })
    );
    expect(txRepo.updateStatus).toHaveBeenCalledWith('c001', TX_STATUS.MATCHED, expect.any(String));
  });

  it('skips when no fiat candidates are within tolerance', async () => {
    const cryptoTx = makeTx('c002', 'CRYPTO', 1000);
    const fiatTx   = makeTx('f002', 'FIAT',   5000); // way off

    txRepo.findUnmatchedCrypto.mockResolvedValue([cryptoTx]);
    txRepo.findCandidateFiat.mockResolvedValue([fiatTx]);

    const results = await reconService.matchTransactions();

    expect(results.skipped).toBe(1);
    expect(results.matched).toBe(0);
    expect(reconRepo.create).not.toHaveBeenCalled();
  });

  it('skips when best candidate fiat tx is already matched', async () => {
    const cryptoTx = makeTx('c003', 'CRYPTO', 1000);
    const fiatTx   = makeTx('f003', 'FIAT',   1000);

    txRepo.findUnmatchedCrypto.mockResolvedValue([cryptoTx]);
    txRepo.findCandidateFiat.mockResolvedValue([fiatTx]);
    reconRepo.findByFiatTx.mockResolvedValue({ _id: 'existing-record' });

    const results = await reconService.matchTransactions();

    expect(results.skipped).toBe(1);
    expect(reconRepo.create).not.toHaveBeenCalled();
  });

  it('returns zero results when no unmatched crypto transactions', async () => {
    txRepo.findUnmatchedCrypto.mockResolvedValue([]);

    const results = await reconService.matchTransactions();

    expect(results.matched).toBe(0);
    expect(results.flagged).toBe(0);
    expect(results.skipped).toBe(0);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns status counts as object', async () => {
    reconRepo.countByStatus.mockResolvedValue([
      { _id: 'AUTO_MATCHED', count: 42 },
      { _id: 'FLAGGED', count: 5 },
    ]);

    const stats = await reconService.getStats();

    expect(stats.AUTO_MATCHED).toBe(42);
    expect(stats.FLAGGED).toBe(5);
    expect(stats.MANUAL_MATCHED).toBe(0); // default
  });
});
