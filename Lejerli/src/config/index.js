'use strict';

require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  server: {
    port: parseInt(process.env.PORT, 10) || 4000,
    host: process.env.HOST || '0.0.0.0',
    prefix: process.env.API_PREFIX || '/api/v1',
  },

  db: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/lejerli',
    options: {
      // Mongoose 8+ uses new connection string parser by default
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'lejerli:',
    disabled: process.env.REDIS_DISABLED === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.REFRESH_JWT_SECRET || 'dev_refresh_secret',
    refreshExpiresIn: process.env.REFRESH_JWT_EXPIRES_IN || '30d',
  },

  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
  },

  rateLimiting: {
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 500,
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.LOG_PRETTY === 'true' || process.env.NODE_ENV !== 'production',
  },

  websocket: {
    path: process.env.WS_PATH || '/ws',
  },

  reconciliation: {
    toleranceUsd: parseFloat(process.env.RECON_TOLERANCE_USD) || 1.0,
    runInterval: process.env.RECON_RUN_INTERVAL || '*/15 * * * *',
    batchSize: parseInt(process.env.RECON_BATCH_SIZE, 10) || 100,
  },

  priceFeed: {
    url: process.env.PRICE_FEED_URL || 'https://api.coingecko.com/api/v3',
    apiKey: process.env.PRICE_FEED_API_KEY || '',
  },
};

module.exports = config;
