'use strict';

const channelRepository = require('./channel.repository');
const auditService = require('../audit/audit.service');
const { cacheGet, cacheSet, cacheDel } = require('../../infrastructure/cache/redis');
const { NotFoundError, ConflictError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const CACHE_TTL = 60; // seconds
const CACHE_KEY_PREFIX = 'channel:';
const ACTIVE_LIST_KEY = 'channels:active';

async function createChannel(data, requestingUserId) {
  const existing = await channelRepository.findByName(data.name);
  if (existing) throw new ConflictError(`Channel "${data.name}" already exists`);

  const channel = await channelRepository.create(data);

  // Invalidate active channel cache on create
  await cacheDel(ACTIVE_LIST_KEY);

  logger.info({ module: 'channels', channelId: channel._id }, 'Channel created');

  await auditService.log({
    userId: requestingUserId,
    action: 'CREATE',
    entity: 'Channel',
    entityId: channel._id,
    newValue: channel,
  });

  return channel;
}

async function getChannelById(id) {
  const cacheKey = `${CACHE_KEY_PREFIX}${id}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const channel = await channelRepository.findById(id);
  if (!channel) throw new NotFoundError('Channel');

  await cacheSet(cacheKey, channel, CACHE_TTL);
  return channel;
}

async function listChannels(filters) {
  return channelRepository.list(filters);
}

async function listActiveChannels() {
  const cached = await cacheGet(ACTIVE_LIST_KEY);
  if (cached) return cached;

  const channels = await channelRepository.listActive();
  await cacheSet(ACTIVE_LIST_KEY, channels, CACHE_TTL);
  return channels;
}

async function listChannelsByType(type) {
  return channelRepository.listByType(type);
}

async function updateChannel(id, updates, requestingUserId) {
  const existing = await channelRepository.findById(id);
  if (!existing) throw new NotFoundError('Channel');

  // Name uniqueness check if name is being changed
  if (updates.name && updates.name !== existing.name) {
    const nameConflict = await channelRepository.findByName(updates.name);
    if (nameConflict) throw new ConflictError(`Channel "${updates.name}" already exists`);
  }

  const updated = await channelRepository.updateById(id, updates);

  // Bust caches
  await cacheDel(`${CACHE_KEY_PREFIX}${id}`);
  await cacheDel(ACTIVE_LIST_KEY);

  logger.info({ module: 'channels', channelId: id }, 'Channel updated');

  await auditService.log({
    userId: requestingUserId,
    action: 'UPDATE',
    entity: 'Channel',
    entityId: id,
    oldValue: existing,
    newValue: updated,
  });

  return updated;
}

async function updateRate(id, { otcRate, markupPercentage, rateMode }, requestingUserId) {
  const existing = await channelRepository.findById(id);
  if (!existing) throw new NotFoundError('Channel');

  const updates = {};
  if (otcRate !== undefined) updates.otcRate = otcRate;
  if (markupPercentage !== undefined) updates.markupPercentage = markupPercentage;
  if (rateMode !== undefined) updates.rateMode = rateMode;

  const updated = await channelRepository.updateById(id, updates);

  await cacheDel(`${CACHE_KEY_PREFIX}${id}`);
  await cacheDel(ACTIVE_LIST_KEY);

  logger.info({ module: 'channels', channelId: id, rateMode }, 'Channel rate updated');

  await auditService.log({
    userId: requestingUserId,
    action: 'RATE_UPDATE',
    entity: 'Channel',
    entityId: id,
    oldValue: { otcRate: existing.otcRate, markupPercentage: existing.markupPercentage, rateMode: existing.rateMode },
    newValue: updates,
  });

  return updated;
}

async function toggleActive(id, requestingUserId) {
  const existing = await channelRepository.findById(id);
  if (!existing) throw new NotFoundError('Channel');

  const updated = existing.isActive
    ? await channelRepository.deactivate(id)
    : await channelRepository.activate(id);

  await cacheDel(`${CACHE_KEY_PREFIX}${id}`);
  await cacheDel(ACTIVE_LIST_KEY);

  const action = existing.isActive ? 'DEACTIVATE' : 'ACTIVATE';
  logger.info({ module: 'channels', channelId: id, action }, 'Channel active status toggled');

  await auditService.log({
    userId: requestingUserId,
    action,
    entity: 'Channel',
    entityId: id,
    oldValue: { isActive: existing.isActive },
    newValue: { isActive: updated.isActive },
  });

  return updated;
}

module.exports = {
  createChannel,
  getChannelById,
  listChannels,
  listActiveChannels,
  listChannelsByType,
  updateChannel,
  updateRate,
  toggleActive,
};
