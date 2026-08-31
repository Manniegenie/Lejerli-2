const express = require('express');
const router = express.Router();

const TradingRoom = require('../models/tradingRoom');
const Desk = require('../models/desk');
const Partner = require('../models/partner');
const User = require('../models/user');
const RoomRoleAssignment = require('../models/roomRoleAssignment');
const AuditLog = require('../models/auditLog');
const { protect } = require('../middleware/auth');

const VALID_ROLES = ['LEAD', 'TRADER', 'OBSERVER'];

/**
 * POST /rooms/:roomId/roles
 * Principal-only. Upserts a RoomRoleAssignment — replaces the role if one
 * already exists for this (roomId, userId) pair rather than erroring on
 * the unique index.
 */
router.post('/:roomId/roles', protect, async (req, res) => {
  const { userId, role } = req.body || {};

  if (!userId || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of ${VALID_ROLES.join(', ')}.` });
  }

  try {
    const room = await TradingRoom.findById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    const desk = await Desk.findById(room.deskId);
    if (!desk) {
      return res.status(404).json({ success: false, message: 'Desk not found.' });
    }

    if (desk.principalUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the Principal can assign room roles.' });
    }

    const existing = await RoomRoleAssignment.findOne({ roomId: room._id, userId });
    const oldRole = existing ? existing.role : null;

    let assignment;
    if (existing) {
      existing.role = role;
      existing.assignedBy = req.user._id;
      assignment = await existing.save();
    } else {
      assignment = await RoomRoleAssignment.create({
        roomId: room._id,
        deskId: desk._id,
        userId,
        role,
        assignedBy: req.user._id,
      });
    }

    await AuditLog.create({
      deskId: desk._id,
      actorUserId: req.user._id,
      action: 'ROOM_ROLE_ASSIGNED',
      entity: 'RoomRoleAssignment',
      entityId: assignment._id,
      oldValue: oldRole,
      newValue: role,
    });

    res.status(200).json({ success: true, message: 'Room role assigned.', data: assignment });
  } catch (error) {
    console.error('assign room role error:', error.message);
    res.status(500).json({ success: false, message: 'Server error assigning room role.' });
  }
});

/**
 * GET /rooms/:roomId
 * Room detail. Determines the caller's role and shapes the response
 * accordingly — disclosureAcknowledgedAt is only meaningful for the
 * partner caller.
 */
router.get('/:roomId', protect, async (req, res) => {
  try {
    const room = await TradingRoom.findById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    const desk = await Desk.findById(room.deskId);
    const partner = await Partner.findById(room.partnerId);
    if (!desk || !partner) {
      return res.status(404).json({ success: false, message: 'Room data incomplete.' });
    }

    const userId = req.user._id.toString();
    let role = null;

    if (desk.principalUserId.toString() === userId) {
      role = 'PRINCIPAL';
    } else {
      const assignment = await RoomRoleAssignment.findOne({ roomId: room._id, userId });
      if (assignment) {
        role = assignment.role;
      } else if (partner.userId.toString() === userId) {
        role = 'PARTNER';
      }
    }

    if (!role) {
      return res.status(403).json({ success: false, message: 'Not permitted.' });
    }

    const partnerUser = await User.findById(partner.userId);

    const data = {
      deskName: desk.name,
      partnerDisplayName: partnerUser ? (partnerUser.displayName || partnerUser.email) : null,
      lineChannelId: room.lineChannelId,
      backstageChannelId: room.backstageChannelId,
      role,
    };

    if (role === 'PARTNER') {
      data.disclosureAcknowledgedAt = room.disclosureAcknowledgedAt;
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('get room error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching room.' });
  }
});

/**
 * POST /rooms/:roomId/disclosure-ack
 * Partner-only — the counterparty confirming the §5 disclosure notice was
 * shown, bound to this specific room.
 */
router.post('/:roomId/disclosure-ack', protect, async (req, res) => {
  try {
    const room = await TradingRoom.findById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    const partner = await Partner.findById(room.partnerId);
    if (!partner || partner.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not permitted.' });
    }

    room.disclosureAcknowledgedAt = new Date();
    await room.save();

    res.status(200).json({
      success: true,
      message: 'Disclosure acknowledged.',
      data: { disclosureAcknowledgedAt: room.disclosureAcknowledgedAt },
    });
  } catch (error) {
    console.error('disclosure ack error:', error.message);
    res.status(500).json({ success: false, message: 'Server error acknowledging disclosure.' });
  }
});

module.exports = router;
