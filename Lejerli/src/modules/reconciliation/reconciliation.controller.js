'use strict';

const reconService = require('./reconciliation.service');

async function triggerRun(req, reply) {
  const results = await reconService.matchTransactions();
  return reply.send({ success: true, data: results });
}

async function manualMatch(req, reply) {
  const record = await reconService.manualMatch(req.params.id, req.user.id);
  return reply.send({ success: true, data: record });
}

async function listRecords(req, reply) {
  const result = await reconService.listRecords(req.query);
  return reply.send({ success: true, ...result });
}

async function getStats(req, reply) {
  const stats = await reconService.getStats();
  return reply.send({ success: true, data: stats });
}

module.exports = { triggerRun, manualMatch, listRecords, getStats };
