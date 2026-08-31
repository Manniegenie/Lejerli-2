const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const Message = require('../models/message');
const { protect } = require('../middleware/auth');
const { checkChannelPermission } = require('../middleware/permissions');
const { createMessage } = require('../services/MessageService');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /channels/:channelId/messages?before=&limit=
 * Cursor-paginated (createdAt-based). Fetched newest-first internally, then
 * reversed so the response is oldest-first — matching the old
 * /chat/rooms/:id/messages contract. Soft-deleted messages are excluded.
 */
router.get('/:channelId/messages', protect, async (req, res) => {
  try {
    const permission = await checkChannelPermission(req.user, req.params.channelId, 'read');
    if (!permission.allowed) {
      return res.status(403).json({ success: false, message: 'Not permitted.' });
    }

    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const query = { channelId: req.params.channelId, deletedAt: null };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!isNaN(before.getTime())) {
        query.createdAt = { $lt: before };
      }
    }

    const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
    messages.reverse();

    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error('get channel messages error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching messages.' });
  }
});

/**
 * POST /channels/:channelId/messages
 * Persists and broadcasts via the shared createMessage() helper — the same
 * function the socket `send_message` handler calls.
 */
router.post(
  '/:channelId/messages',
  protect,
  [body('text').trim().notEmpty().withMessage('text is required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    try {
      const permission = await checkChannelPermission(req.user, req.params.channelId, 'write');
      if (!permission.allowed) {
        return res.status(403).json({ success: false, message: 'Not permitted.' });
      }

      const message = await createMessage({
        channelId: req.params.channelId,
        senderId: req.user._id,
        text: req.body.text,
      });

      res.status(201).json({ success: true, message: 'Message sent.', data: message });
    } catch (error) {
      console.error('post channel message error:', error.message);
      res.status(500).json({ success: false, message: 'Server error creating message.' });
    }
  }
);

module.exports = router;
