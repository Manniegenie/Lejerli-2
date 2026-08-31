const Message = require('../models/message');

/**
 * Module-level Socket.IO reference, set once by server.js after it creates
 * the io instance (setIo below). Kept as a plain module variable rather
 * than dependency-injection machinery — this file doesn't need more than
 * that to let both the REST route and the socket handler share one
 * persist+broadcast path.
 */
let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

/**
 * Single place that creates a Message and broadcasts it. Called by both
 * POST /channels/:channelId/messages and the socket `send_message` handler
 * so persistence and real-time delivery never drift apart.
 */
async function createMessage({ channelId, senderId, text }) {
  const message = await Message.create({
    channelId,
    senderId,
    type: 'TEXT',
    body: { text, mediaUrl: null, ciphertext: null },
  });

  if (ioInstance) {
    ioInstance.to(channelId.toString()).emit('new_message', message);
  }

  return message;
}

module.exports = { createMessage, setIo };
