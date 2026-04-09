'use strict';

const fp = require('fastify-plugin');
const ctrl = require('./user.controller');
const { ROLES } = require('./user.model');

const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      role: { type: 'string', enum: Object.values(ROLES) },
    },
    additionalProperties: false,
  },
};

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

const listUsersSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      role: { type: 'string', enum: Object.values(ROLES) },
      isActive: { type: 'boolean' },
    },
  },
};

async function userRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // ── Public routes ────────────────────────────────────────────────────
  fastify.post('/auth/register', { schema: registerSchema }, ctrl.register);
  fastify.post('/auth/login', { schema: loginSchema }, ctrl.login);

  // ── Authenticated routes ─────────────────────────────────────────────
  fastify.get('/users/me', { onRequest: [authenticate] }, ctrl.getMe);

  fastify.get(
    '/users/:id',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN, ROLES.OPS, ROLES.AUDITOR])] },
    ctrl.getUser
  );

  fastify.get(
    '/users',
    { schema: listUsersSchema, onRequest: [authenticate, requireRole([ROLES.ADMIN, ROLES.OPS])] },
    ctrl.listUsers
  );

  fastify.patch(
    '/users/:id',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN])] },
    ctrl.updateUser
  );

  fastify.delete(
    '/users/:id',
    { onRequest: [authenticate, requireRole([ROLES.ADMIN])] },
    ctrl.deactivateUser
  );
}

module.exports = fp(userRoutes, { name: 'userRoutes' });
