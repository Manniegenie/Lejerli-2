'use strict';

const fp = require('fastify-plugin');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

/**
 * Auth Plugin — registers JWT + RBAC helpers on the Fastify instance.
 *
 * Decorates fastify with:
 *   fastify.authenticate          — verifies JWT on the request
 *   fastify.requireRole(roles[])  — factory that returns a role-check hook
 *
 * @fastify/jwt is registered in server.js so it's available here.
 */
async function authPlugin(fastify) {
  // ── authenticate ────────────────────────────────────────────────────
  fastify.decorate('authenticate', async function (req, reply) {
    try {
      await req.jwtVerify();
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired token');
    }
  });

  // ── requireRole ─────────────────────────────────────────────────────
  fastify.decorate('requireRole', function (allowedRoles) {
    return async function checkRole(req) {
      if (!req.user) throw new UnauthorizedError();
      if (!allowedRoles.includes(req.user.role)) {
        throw new ForbiddenError(
          `Role "${req.user.role}" is not permitted for this operation`
        );
      }
    };
  });
}

module.exports = fp(authPlugin, { name: 'authPlugin', dependencies: [] });
