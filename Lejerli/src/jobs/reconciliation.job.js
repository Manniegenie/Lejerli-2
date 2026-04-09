'use strict';

const cron = require('node-cron');
const reconService = require('../modules/reconciliation/reconciliation.service');
const config = require('../config');
const logger = require('../utils/logger');

let task = null;
let isRunning = false;

/**
 * Reconciliation Background Job.
 *
 * Runs on the configured cron interval (default: every 15 minutes).
 * Uses an in-process lock (isRunning) to prevent overlapping runs —
 * important for high-volume OTC where a single batch may take > interval.
 *
 * For multi-instance deployments, replace isRunning with a Redis
 * distributed lock (SET NX PX) before Phase 2 scale-out.
 */

function start() {
  const interval = config.reconciliation.runInterval;

  if (!cron.validate(interval)) {
    logger.error({ module: 'recon-job', interval }, 'Invalid cron expression — reconciliation job NOT started');
    return;
  }

  task = cron.schedule(interval, async () => {
    if (isRunning) {
      logger.warn({ module: 'recon-job' }, 'Previous reconciliation run still in progress — skipping');
      return;
    }

    isRunning = true;
    const startTime = Date.now();
    logger.info({ module: 'recon-job' }, 'Reconciliation cron triggered');

    try {
      const results = await reconService.matchTransactions();
      const duration = Date.now() - startTime;
      logger.info({ module: 'recon-job', results, duration }, 'Reconciliation cron completed');
    } catch (err) {
      logger.error({ module: 'recon-job', err }, 'Reconciliation cron failed');
    } finally {
      isRunning = false;
    }
  });

  logger.info({ module: 'recon-job', interval }, 'Reconciliation cron job started');
}

function stop() {
  if (task) {
    task.stop();
    task = null;
    logger.info({ module: 'recon-job' }, 'Reconciliation cron job stopped');
  }
}

module.exports = { start, stop };
