'use strict';

const fp = require('fastify-plugin');
const { AppError } = require('../utils/errors');

/**
 * Centralized Error Handler Plugin.
 *
 * Handles:
 *   1. AppError subclasses (our operational errors)
 *   2. Fastify validation errors (JSON Schema failures → 400)
 *   3. JWT errors from @fastify/jwt
 *   4. Mongoose validation and cast errors
 *   5. Generic unexpected errors → 500 (no leak of internals in production)
 */
async function errorPlugin(fastify) {
  fastify.setErrorHandler(function (error, req, reply) {
    const log = req.log || fastify.log;

    // ── Fastify JSON Schema Validation ──────────────────────────────────
    if (error.validation) {
      return reply.code(400).send({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation.map((v) => ({
          field: v.instancePath || v.schemaPath,
          message: v.message,
        })),
      });
    }

    // ── Our operational errors ───────────────────────────────────────────
    if (error instanceof AppError) {
      log.warn({ err: error, reqId: req.id }, `[${error.code}] ${error.message}`);
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    // ── JWT errors ───────────────────────────────────────────────────────
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || error.statusCode === 401) {
      return reply.code(401).send({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    // ── Mongoose Validation Error ────────────────────────────────────────
    if (error.name === 'ValidationError' && error.errors) {
      const details = Object.values(error.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      return reply.code(400).send({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Database validation failed',
        details,
      });
    }

    // ── Mongoose CastError (bad ObjectId format) ─────────────────────────
    if (error.name === 'CastError') {
      return reply.code(400).send({
        success: false,
        code: 'BAD_REQUEST',
        message: `Invalid format for field: ${error.path}`,
      });
    }

    // ── MongoDB duplicate key ────────────────────────────────────────────
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0] || 'field';
      return reply.code(409).send({
        success: false,
        code: 'CONFLICT',
        message: `Duplicate value for ${field}`,
      });
    }

    // ── Unexpected errors ────────────────────────────────────────────────
    log.error({ err: error, reqId: req.id }, 'Unhandled server error');

    return reply.code(500).send({
      success: false,
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : error.message,
    });
  });

  // 404 handler
  fastify.setNotFoundHandler(function (req, reply) {
    reply.code(404).send({
      success: false,
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.url} not found`,
    });
  });
}

module.exports = fp(errorPlugin, { name: 'errorPlugin' });
