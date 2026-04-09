'use strict';

const logger = require('../../utils/logger');

/**
 * WebSocket manager.
 *
 * Registered via @fastify/websocket plugin.
 * Provides a typed broadcast mechanism for real-time reconciliation events,
 * rate feeds, and transaction status updates.
 *
 * All WS connections are tracked per-room so updates are scoped.
 */

const rooms = new Map(); // roomName → Set<WebSocket>

function joinRoom(roomName, socket) {
  if (!rooms.has(roomName)) rooms.set(roomName, new Set());
  rooms.get(roomName).add(socket);
  logger.info({ module: 'ws', room: roomName }, 'Client joined WS room');
}

function leaveRoom(roomName, socket) {
  const room = rooms.get(roomName);
  if (!room) return;
  room.delete(socket);
  if (room.size === 0) rooms.delete(roomName);
}

/**
 * Broadcast a typed event to all subscribers of a room.
 * @param {string} roomName
 * @param {string} event - event type identifier (e.g. 'RECON_MATCH', 'RATE_UPDATE')
 * @param {object} payload
 */
function broadcast(roomName, event, payload) {
  const room = rooms.get(roomName);
  if (!room || room.size === 0) return;

  const message = JSON.stringify({ event, payload, ts: Date.now() });
  let dead = [];

  for (const socket of room) {
    if (socket.readyState !== 1 /* OPEN */) {
      dead.push(socket);
      continue;
    }
    try {
      socket.send(message);
    } catch (err) {
      logger.warn({ module: 'ws', err, event }, 'Failed to send WS message');
      dead.push(socket);
    }
  }

  // Clean up closed sockets
  dead.forEach((s) => leaveRoom(roomName, s));
}

/**
 * Register the /ws Fastify route.
 * Clients connect and send: { action: 'subscribe', room: 'reconciliation' }
 */
function registerWsRoutes(fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    logger.info({ module: 'ws', ip: req.ip }, 'New WS connection');

    const subscribedRooms = new Set();

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.action === 'subscribe' && msg.room) {
          joinRoom(msg.room, socket);
          subscribedRooms.add(msg.room);
          socket.send(JSON.stringify({ event: 'subscribed', room: msg.room }));
        }

        if (msg.action === 'unsubscribe' && msg.room) {
          leaveRoom(msg.room, socket);
          subscribedRooms.delete(msg.room);
        }

        if (msg.action === 'ping') {
          socket.send(JSON.stringify({ event: 'pong', ts: Date.now() }));
        }
      } catch (err) {
        logger.warn({ module: 'ws', err }, 'Malformed WS message received');
      }
    });

    socket.on('close', () => {
      subscribedRooms.forEach((r) => leaveRoom(r, socket));
      logger.info({ module: 'ws' }, 'WS connection closed');
    });

    socket.on('error', (err) => {
      logger.error({ module: 'ws', err }, 'WS socket error');
    });
  });
}

module.exports = { registerWsRoutes, broadcast, joinRoom, leaveRoom };
