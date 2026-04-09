'use strict';

const txService = require('./transaction.service');

async function createTransaction(req, reply) {
  const tx = await txService.createTransaction(req.body, req.user.id);
  return reply.code(201).send({ success: true, data: tx });
}

async function getTransaction(req, reply) {
  const tx = await txService.getTransactionById(req.params.id);
  return reply.send({ success: true, data: tx });
}

async function listTransactions(req, reply) {
  const result = await txService.listTransactions(req.query);
  return reply.send({ success: true, ...result });
}

async function updateStatus(req, reply) {
  const { status, note } = req.body;
  const updated = await txService.updateTransactionStatus(req.params.id, status, note, req.user.id);
  return reply.send({ success: true, data: updated });
}

async function getVolumeAnalytics(req, reply) {
  const data = await txService.getVolumeAnalytics(req.query);
  return reply.send({ success: true, data });
}

module.exports = { createTransaction, getTransaction, listTransactions, updateStatus, getVolumeAnalytics };
