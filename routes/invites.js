const express = require('express');
const router = express.Router();

const Invite = require('../models/invite');
const Desk = require('../models/desk');
const User = require('../models/user');
const FloorMembership = require('../models/floorMembership');
const Partner = require('../models/partner');
const TradingRoom = require('../models/tradingRoom');
const Channel = require('../models/channel');
const AuditLog = require('../models/auditLog');
const { protect } = require('../middleware/auth');

/**
 * GET /invites/:token
 * Public (no auth) — lets the app show "You're invited to join [desk]"
 * before the recipient has signed in, so it knows what to render on the
 * deep-link screen either way.
 */
router.get('/:token', async (req, res) => {
  try {
    const invite = await Invite.findOne({ token: req.params.token });
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invite not found.' });
    }

    if (invite.status === 'PENDING' && invite.expiresAt < new Date()) {
      invite.status = 'EXPIRED';
      await invite.save();
    }

    if (invite.status === 'EXPIRED') {
      return res.status(410).json({ success: false, message: 'This invite has expired.' });
    }
    if (invite.status === 'ACCEPTED') {
      return res.status(409).json({ success: false, message: 'This invite has already been accepted.' });
    }

    const desk = await Desk.findById(invite.deskId);
    const inviter = await User.findById(invite.invitedByUserId);

    res.status(200).json({
      success: true,
      data: {
        type: invite.type,
        targetEmail: invite.targetEmail,
        deskName: desk ? desk.name : 'a desk',
        inviterName: inviter ? (inviter.displayName || inviter.email) : null,
      },
    });
  } catch (error) {
    console.error('get invite error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching invite.' });
  }
});

/**
 * POST /invites/:token/accept
 * Requires the recipient to be logged in already (they get there via the
 * deep link -> sign up or log in with the invited email -> back here).
 * Creates the FloorMembership or Partner+TradingRoom+Channels only now,
 * not at invite-creation time.
 */
router.post('/:token/accept', protect, async (req, res) => {
  try {
    const invite = await Invite.findOne({ token: req.params.token });
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invite not found.' });
    }

    if (invite.status === 'PENDING' && invite.expiresAt < new Date()) {
      invite.status = 'EXPIRED';
      await invite.save();
    }
    if (invite.status !== 'PENDING') {
      return res.status(410).json({ success: false, message: 'This invite is no longer valid.' });
    }

    if (req.user.email.toLowerCase() !== invite.targetEmail.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'This invite was sent to a different email address. Sign in with that email to accept it.',
      });
    }

    const desk = await Desk.findById(invite.deskId);
    if (!desk) {
      return res.status(404).json({ success: false, message: 'Desk not found.' });
    }

    let result;

    if (invite.type === 'FLOOR') {
      let membership = await FloorMembership.findOne({ deskId: desk._id, userId: req.user._id });
      if (membership) {
        membership.status = 'ACTIVE';
        membership.removedAt = null;
        await membership.save();
      } else {
        membership = await FloorMembership.create({
          deskId: desk._id,
          userId: req.user._id,
          status: 'ACTIVE',
        });
      }
      result = { type: 'FLOOR', membership };

      await AuditLog.create({
        deskId: desk._id,
        actorUserId: req.user._id,
        action: 'FLOOR_INVITE_ACCEPTED',
        entity: 'FloorMembership',
        entityId: membership._id,
        newValue: { userId: req.user._id, status: membership.status },
      });
    } else {
      let partner = await Partner.findOne({ deskId: desk._id, userId: req.user._id });
      if (partner) {
        partner.status = 'ACTIVE';
        partner.connectedAt = new Date();
        await partner.save();
      } else {
        partner = await Partner.create({
          deskId: desk._id,
          userId: req.user._id,
          status: 'ACTIVE',
          invitedBy: invite.invitedByUserId,
          connectedAt: new Date(),
        });
      }

      let room = await TradingRoom.findOne({ deskId: desk._id, partnerId: partner._id });
      if (!room) {
        room = await TradingRoom.create({ deskId: desk._id, partnerId: partner._id });
      }
      if (!room.lineChannelId || !room.backstageChannelId) {
        const lineChannel = await Channel.create({ type: 'LINE', roomId: room._id });
        const backstageChannel = await Channel.create({ type: 'BACKSTAGE', roomId: room._id });
        room.lineChannelId = lineChannel._id;
        room.backstageChannelId = backstageChannel._id;
        await room.save();
      }
      result = { type: 'PARTNER', partner, room };

      await AuditLog.create({
        deskId: desk._id,
        actorUserId: req.user._id,
        action: 'PARTNER_INVITE_ACCEPTED',
        entity: 'Partner',
        entityId: partner._id,
        newValue: { userId: req.user._id, status: partner.status },
      });
    }

    invite.status = 'ACCEPTED';
    await invite.save();

    res.status(200).json({ success: true, message: 'Invite accepted.', data: result });
  } catch (error) {
    console.error('accept invite error:', error.message);
    res.status(500).json({ success: false, message: 'Server error accepting invite.' });
  }
});

module.exports = router;
