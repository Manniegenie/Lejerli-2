'use strict';

const channelService = require('./channel.service');

/**
 * ChannelController — HTTP layer only.
 * Thin adapter between HTTP and the channel service layer.
 */

async function createChannel(req, reply) {
  const channel = await channelService.createChannel(req.body, req.user.id);
  return reply.code(201).send({ success: true, data: channel });
}

async function getChannel(req, reply) {
  const channel = await channelService.getChannelById(req.params.id);
  return reply.send({ success: true, data: channel });
}

async function listChannels(req, reply) {
  const result = await channelService.listChannels(req.query);
  return reply.send({ success: true, ...result });
}

async function listActiveChannels(req, reply) {
  const channels = await channelService.listActiveChannels();
  return reply.send({ success: true, data: channels });
}

async function listChannelsByType(req, reply) {
  const channels = await channelService.listChannelsByType(req.params.type);
  return reply.send({ success: true, data: channels });
}

async function updateChannel(req, reply) {
  const updated = await channelService.updateChannel(req.params.id, req.body, req.user.id);
  return reply.send({ success: true, data: updated });
}

async function updateRate(req, reply) {
  const updated = await channelService.updateRate(req.params.id, req.body, req.user.id);
  return reply.send({ success: true, data: updated });
}

async function toggleActive(req, reply) {
  const updated = await channelService.toggleActive(req.params.id, req.user.id);
  return reply.send({ success: true, data: updated });
}

module.exports = {
  createChannel,
  getChannel,
  listChannels,
  listActiveChannels,
  listChannelsByType,
  updateChannel,
  updateRate,
  toggleActive,
};
