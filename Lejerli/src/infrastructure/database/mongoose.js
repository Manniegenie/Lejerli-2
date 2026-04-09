'use strict';

const mongoose = require('mongoose');
const config = require('../../config');
const logger = require('../../utils/logger');

let isConnected = false;

async function connectDatabase() {
  if (isConnected) {
    logger.info({ module: 'db' }, 'Reusing existing MongoDB connection');
    return;
  }

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info({ module: 'db' }, 'MongoDB connected successfully');
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn({ module: 'db' }, 'MongoDB disconnected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error({ module: 'db', err }, 'MongoDB connection error');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info({ module: 'db' }, 'MongoDB connection closed on app termination');
    process.exit(0);
  });

  await mongoose.connect(config.db.uri, config.db.options);
}

async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.connection.close();
  isConnected = false;
  logger.info({ module: 'db' }, 'MongoDB disconnected by application');
}

module.exports = { connectDatabase, disconnectDatabase };
