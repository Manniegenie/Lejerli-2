'use strict';

const auditRepository = require('./audit.repository');
const logger = require('../../utils/logger');

/**
 * AuditService — fire-and-forget logging for all state mutations.
 *
 * Callers should NOT await this in the critical path; instead use:
 *   auditService.log({...}).catch(err => logger.error({err}, 'Audit failed'))
 */

async function log({ userId = null, action, entity, entityId, oldValue = null, newValue = null, ipAddress, userAgent }) {
  try {
    return await auditRepository.create({
      userId,
      action,
      entity,
      entityId,
      oldValue,
      newValue,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });
  } catch (err) {
    // Audit failures must never crash the application
    logger.error({ module: 'audit', err }, 'Failed to write audit log');
    return null;
  }
}

async function getEntityHistory(entity, entityId, pagination) {
  return auditRepository.listByEntity(entity, entityId, pagination);
}

async function getUserActivity(userId, pagination) {
  return auditRepository.listByUser(userId, pagination);
}

module.exports = { log, getEntityHistory, getUserActivity };
