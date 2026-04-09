'use strict';

require('dotenv').config();

const Fastify = require('fastify');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDatabase } = require('./src/infrastructure/database/mongoose');
const { getRedisClient } = require('./src/infrastructure/cache/redis');
const { registerWsRoutes } = require('./src/infrastructure/websocket/ws');
const reconJob = require('./src/jobs/reconciliation.job');

// ── Build Fastify instance ───────────────────────────────────────────────

const fastify = Fastify({
  logger: config.log.pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
        level: config.log.level,
      }
    : { level: config.log.level },
  trustProxy: true,
  // Expose config on the instance for use in controllers
  genReqId: () => require('crypto').randomUUID(),
});

// Make config available on the fastify instance
fastify.decorate('config', config);

// ── Security plugins ─────────────────────────────────────────────────────

fastify.register(require('@fastify/helmet'), {
  contentSecurityPolicy: false, // Configured per-route in production as needed
});

fastify.register(require('@fastify/cors'), {
  origin: config.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

fastify.register(require('@fastify/rate-limit'), {
  max: config.rateLimiting.max,
  timeWindow: config.rateLimiting.timeWindow,
  errorResponseBuilder(req, context) {
    return {
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Retry in ${Math.round(context.after / 1000)}s`,
    };
  },
});

// ── JWT plugin ───────────────────────────────────────────────────────────

fastify.register(require('@fastify/jwt'), {
  secret: config.jwt.secret,
  sign: { expiresIn: config.jwt.expiresIn },
});

// ── WebSocket plugin ─────────────────────────────────────────────────────

fastify.register(require('@fastify/websocket'));

// ── Custom plugins ───────────────────────────────────────────────────────

fastify.register(require('./src/plugins/error.plugin'));
fastify.register(require('./src/plugins/auth.plugin'));

// ── Health check (unauthenticated) ───────────────────────────────────────

fastify.get('/health', {
  schema: {
    response: {
      200: {
        type: 'object',
        properties: {
          status:  { type: 'string' },
          version: { type: 'string' },
          ts:      { type: 'string' },
        },
      },
    },
  },
}, async (req, reply) => {
  return reply.send({
    status: 'ok',
    version: require('./package.json').version,
    ts: new Date().toISOString(),
  });
});

// ── Domain routes — all prefixed with /api/v1 ────────────────────────────

const prefix = config.server.prefix;

fastify.register(require('./src/modules/users/user.routes'),            { prefix });
fastify.register(require('./src/modules/channels/channel.routes'),      { prefix });
fastify.register(require('./src/modules/transactions/transaction.routes'), { prefix });
fastify.register(require('./src/modules/reconciliation/reconciliation.routes'), { prefix });

// ── WebSocket routes ─────────────────────────────────────────────────────

fastify.register(async (wsInstance) => {
  registerWsRoutes(wsInstance);
});

// ── Graceful shutdown ────────────────────────────────────────────────────

async function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');

  reconJob.stop();

  try {
    await fastify.close();
    logger.info('Fastify closed');

    const mongoose = require('mongoose');
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');

    const redis = getRedisClient();
    if (redis) {
      await redis.quit();
      logger.info('Redis connection closed');
    }

    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Promise Rejection');
  // Do NOT process.exit — let the request fail gracefully
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception — forcing shutdown');
  gracefulShutdown('uncaughtException');
});

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap() {
  try {
    // 1. Connect to MongoDB
    await connectDatabase();

    // 2. Warm up Redis (non-blocking — failures are safe-fail)
    getRedisClient();

    // 3. Start Fastify
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(
      { port: config.server.port, env: config.env, prefix },
      `🚀  Lejerli Server running`
    );

    // 4. Start background jobs after server is live
    reconJob.start();
    logger.info('📊  Reconciliation job scheduled');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
