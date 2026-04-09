'use strict';

const Redis = require('ioredis');
const config = require('../../config');
const logger = require('../../utils/logger');

let client = null;

function getRedisClient() {
  if (config.redis.disabled) {
    logger.warn({ module: 'redis' }, 'Redis is disabled via REDIS_DISABLED flag — using null client');
    return null;
  }

  if (client) return client;

  client = new Redis(config.redis.url, {
    password: config.redis.password || undefined,
    keyPrefix: config.redis.keyPrefix,
    retryStrategy(times) {
      if (times > 10) {
        logger.error({ module: 'redis' }, 'Redis retry limit exceeded — giving up');
        return null; // stop retrying
      }
      const delay = Math.min(times * 100, 3000);
      logger.warn({ module: 'redis', attempt: times }, `Redis retry in ${delay}ms`);
      return delay;
    },
    lazyConnect: false,
  });

  client.on('connect', () => logger.info({ module: 'redis' }, 'Redis connected'));
  client.on('ready', () => logger.info({ module: 'redis' }, 'Redis ready'));
  client.on('error', (err) => logger.error({ module: 'redis', err }, 'Redis error'));
  client.on('close', () => logger.warn({ module: 'redis' }, 'Redis connection closed'));
  client.on('reconnecting', () => logger.info({ module: 'redis' }, 'Redis reconnecting'));

  return client;
}

/**
 * Cache helpers — all safe-fail: if Redis is unavailable,
 * operations degrade gracefully rather than crashing the app.
 */
async function cacheGet(key) {
  const c = getRedisClient();
  if (!c) return null;
  try {
    const val = await c.get(key);
    return val ? JSON.parse(val) : null;
  } catch (err) {
    logger.warn({ module: 'redis', err, key }, 'cacheGet failed');
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds = 300) {
  const c = getRedisClient();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ module: 'redis', err, key }, 'cacheSet failed');
  }
}

async function cacheDel(key) {
  const c = getRedisClient();
  if (!c) return;
  try {
    await c.del(key);
  } catch (err) {
    logger.warn({ module: 'redis', err, key }, 'cacheDel failed');
  }
}

async function cacheDelPattern(pattern) {
  const c = getRedisClient();
  if (!c) return;
  try {
    const keys = await c.keys(pattern);
    if (keys.length) {
      // Strip the prefix that ioredis adds before passing to DEL
      const rawKeys = keys.map((k) => k.replace(new RegExp(`^${config.redis.keyPrefix}`), ''));
      await c.del(...rawKeys);
    }
  } catch (err) {
    logger.warn({ module: 'redis', err, pattern }, 'cacheDelPattern failed');
  }
}

module.exports = {
  getRedisClient,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
};
