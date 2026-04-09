'use strict';

const fp = require('fastify-plugin');
const ctrl = require('./channel.controller');
const { CHANNEL_TYPE, RATE_MODE } = require('./channel.model');
const { ROLES } = require('../users/user.model');

// ── JSON Schema definitions ──────────────────────────────────────────────

const channelBodySchema = {
  type: 'object',
  required: ['name', 'type'],
  properties: {
    name:              { type: 'string', minLength: 1, maxLength: 100 },
    type:              { type: 'string', enum: Object.values(CHANNEL_TYPE) },
    asset:             { type: 'string', maxLength: 20 },
    currency:          { type: 'string', maxLength: 10 },
    country:           { type: 'string', maxLength: 2 },
    rateMode:          { type: 'string', enum: Object.values(RATE_MODE) },
    otcRate:           { type: 'number', minimum: 0 },
    markupPercentage:  { type: 'number', minimum: -100, maximum: 1000 },
    referenceSource:   { type: 'string', maxLength: 100 },
    isActive:          { type: 'boolean' },
    metadata:          { type: 'object' },
  },
  additionalProperties: false,
};

const updateChannelSchema = {
  body: {
    type: 'object',
    properties: {
      name:             { type: 'string', minLength: 1, maxLength: 100 },
      rateMode:         { type: 'string', enum: Object.values(RATE_MODE) },
      otcRate:          { type: 'number', minimum: 0 },
      markupPercentage: { type: 'number', minimum: -100, maximum: 1000 },
      referenceSource:  { type: 'string', maxLength: 100 },
      metadata:         { type: 'object' },
    },
    additionalProperties: false,
  },
};

const updateRateSchema = {
  body: {
    type: 'object',
    properties: {
      otcRate:          { type: 'number', minimum: 0 },
      markupPercentage: { type: 'number', minimum: -100, maximum: 1000 },
      rateMode:         { type: 'string', enum: Object.values(RATE_MODE) },
    },
    additionalProperties: false,
  },
};

const listSchema = {
  querystring: {
    type: 'object',
    properties: {
      page:     { type: 'integer', minimum: 1, default: 1 },
      limit:    { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      type:     { type: 'string', enum: Object.values(CHANNEL_TYPE) },
      isActive: { type: 'boolean' },
    },
  },
};

// ── Route registration ───────────────────────────────────────────────────

async function channelRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  const adminOps = [ROLES.ADMIN, ROLES.OPS];

  // Public — active channels for rate display (traders can read)
  fastify.get('/channels/active', ctrl.listActiveChannels);

  fastify.get(
    '/channels/type/:type',
    {
      schema: {
        params: { type: 'object', properties: { type: { type: 'string', enum: Object.values(CHANNEL_TYPE) } } },
      },
    },
    ctrl.listChannelsByType
  );

  // Authenticated — read
  fastify.get(
    '/channels/:id',
    { onRequest: [authenticate] },
    ctrl.getChannel
  );

  fastify.get(
    '/channels',
    { schema: listSchema, onRequest: [authenticate] },
    ctrl.listChannels
  );

  // Admin/Ops — write operations
  fastify.post(
    '/channels',
    { schema: { body: channelBodySchema }, onRequest: [authenticate, requireRole(adminOps)] },
    ctrl.createChannel
  );

  fastify.patch(
    '/channels/:id',
    { schema: updateChannelSchema, onRequest: [authenticate, requireRole(adminOps)] },
    ctrl.updateChannel
  );

  // Rate update has its own endpoint so traders can see it in audit logs distinctly
  fastify.patch(
    '/channels/:id/rate',
    { schema: updateRateSchema, onRequest: [authenticate, requireRole(adminOps)] },
    ctrl.updateRate
  );

  fastify.patch(
    '/channels/:id/toggle',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN])] },
    ctrl.toggleActive
  );
}

module.exports = fp(channelRoutes, { name: 'channelRoutes' });
