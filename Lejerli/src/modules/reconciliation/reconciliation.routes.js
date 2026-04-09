'use strict';

const fp = require('fastify-plugin');
const ctrl = require('./reconciliation.controller');
const { RECON_STATUS } = require('./reconciliation.model');
const { ROLES } = require('../users/user.model');

const listSchema = {
  querystring: {
    type: 'object',
    properties: {
      page:   { type: 'integer', minimum: 1, default: 1 },
      limit:  { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      status: { type: 'string', enum: Object.values(RECON_STATUS) },
    },
  },
};

async function reconciliationRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  const opsAdminAuditor = [ROLES.ADMIN, ROLES.OPS, ROLES.AUDITOR];

  // Trigger a reconciliation run manually (also runs via cron)
  fastify.post(
    '/reconciliation/run',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN, ROLES.OPS])] },
    ctrl.triggerRun
  );

  // Confirm a FLAGGED match manually
  fastify.post(
    '/reconciliation/:id/manual-match',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN, ROLES.OPS])] },
    ctrl.manualMatch
  );

  fastify.get(
    '/reconciliation',
    { schema: listSchema, onRequest: [authenticate, requireRole(opsAdminAuditor)] },
    ctrl.listRecords
  );

  fastify.get(
    '/reconciliation/stats',
    { onRequest: [authenticate, requireRole(opsAdminAuditor)] },
    ctrl.getStats
  );
}

module.exports = fp(reconciliationRoutes, { name: 'reconciliationRoutes' });
