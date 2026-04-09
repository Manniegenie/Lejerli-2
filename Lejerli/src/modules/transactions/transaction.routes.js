'use strict';

const fp = require('fastify-plugin');
const ctrl = require('./transaction.controller');
const { TX_TYPE, TX_DIRECTION, TX_STATUS } = require('./transaction.model');
const { ROLES } = require('../users/user.model');

const createTxSchema = {
  body: {
    type: 'object',
    required: ['channelId', 'type', 'direction', 'amount'],
    properties: {
      channelId:       { type: 'string', minLength: 24, maxLength: 24 },
      type:            { type: 'string', enum: Object.values(TX_TYPE) },
      direction:       { type: 'string', enum: Object.values(TX_DIRECTION) },
      asset:           { type: 'string', maxLength: 20 },
      amount:          { type: 'number', exclusiveMinimum: 0 },
      usdValue:        { type: 'number', minimum: 0 },
      rateAtExecution: { type: 'number', minimum: 0 },
      counterparty:    { type: 'string', maxLength: 300 },
      reference:       { type: 'string', maxLength: 200 },
      metadata:        { type: 'object' },
    },
    additionalProperties: false,
  },
};

const updateStatusSchema = {
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: Object.values(TX_STATUS) },
      note:   { type: 'string', maxLength: 500 },
    },
    additionalProperties: false,
  },
};

const listSchema = {
  querystring: {
    type: 'object',
    properties: {
      page:      { type: 'integer', minimum: 1, default: 1 },
      limit:     { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      channelId: { type: 'string' },
      type:      { type: 'string', enum: Object.values(TX_TYPE) },
      direction: { type: 'string', enum: Object.values(TX_DIRECTION) },
      status:    { type: 'string', enum: Object.values(TX_STATUS) },
      fromDate:  { type: 'string', format: 'date-time' },
      toDate:    { type: 'string', format: 'date-time' },
    },
  },
};

async function transactionRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  const opsUp = [ROLES.ADMIN, ROLES.OPS, ROLES.TRADER];

  fastify.post(
    '/transactions',
    { schema: createTxSchema, onRequest: [authenticate, requireRole(opsUp)] },
    ctrl.createTransaction
  );

  fastify.get(
    '/transactions/:id',
    { onRequest: [authenticate] },
    ctrl.getTransaction
  );

  fastify.get(
    '/transactions',
    { schema: listSchema, onRequest: [authenticate] },
    ctrl.listTransactions
  );

  fastify.patch(
    '/transactions/:id/status',
    { schema: updateStatusSchema, onRequest: [authenticate, requireRole([ROLES.ADMIN, ROLES.OPS])] },
    ctrl.updateStatus
  );

  fastify.get(
    '/analytics/volume',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN, ROLES.OPS, ROLES.AUDITOR])] },
    ctrl.getVolumeAnalytics
  );
}

module.exports = fp(transactionRoutes, { name: 'transactionRoutes' });
