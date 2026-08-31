const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const Desk = require('../models/desk');
const Channel = require('../models/channel');
const FloorMembership = require('../models/floorMembership');
const Invite = require('../models/invite');
const AuditLog = require('../models/auditLog');
const { protect } = require('../middleware/auth');
const { sendInviteEmail } = require('../services/EmailService');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function createAndSendInvite({ deskId, deskName, type, email, invitedByUserId, inviterName }) {
  const invite = await Invite.create({
    deskId,
    type,
    invitedByUserId,
    targetEmail: email,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  const deepLink = `lejerli://invite/${invite.token}`;
  invite.deepLink = deepLink;
  await invite.save();

  sendInviteEmail(email, { inviterName, deskName, type, deepLink }).catch((err) => {
    console.error('invite email failed (non-blocking):', err.message);
  });

  return invite;
}

/**
 * POST /desks
 * Creates a Desk with the caller as Principal (Desk.principalUserId), plus
 * a default "general" Floor Channel and the Principal's own FloorMembership
 * row — a Desk always has at least one Floor Channel and one active member
 * (itself) from the moment it exists.
 */
router.post(
  '/',
  protect,
  [body('name').trim().notEmpty().withMessage('name is required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    try {
      const desk = await Desk.create({
        name: req.body.name,
        principalUserId: req.user._id,
      });

      await Channel.create({
        type: 'FLOOR',
        deskId: desk._id,
        roomId: null,
        name: 'general',
      });

      await FloorMembership.create({
        deskId: desk._id,
        userId: req.user._id,
        status: 'ACTIVE',
      });

      await AuditLog.create({
        deskId: desk._id,
        actorUserId: req.user._id,
        action: 'DESK_CREATED',
        entity: 'Desk',
        entityId: desk._id,
        newValue: { name: desk.name },
      });

      res.status(201).json({ success: true, message: 'Desk created.', data: desk });
    } catch (error) {
      console.error('create desk error:', error.message);
      res.status(500).json({ success: false, message: 'Server error creating desk.' });
    }
  }
);

/**
 * GET /desks/mine
 * Desks the caller is Principal of, or an active Floor member of.
 */
router.get('/mine', protect, async (req, res) => {
  try {
    const memberships = await FloorMembership.find({ userId: req.user._id, status: 'ACTIVE' }).select('deskId');
    const memberDeskIds = memberships.map((m) => m.deskId);

    const desks = await Desk.find({
      $or: [
        { principalUserId: req.user._id },
        { _id: { $in: memberDeskIds } },
      ],
    });

    res.status(200).json({ success: true, data: desks });
  } catch (error) {
    console.error('get desks/mine error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching desks.' });
  }
});

/**
 * POST /desks/:deskId/floor-invites
 * Principal-only. Invites a floor member by email — works whether or not
 * they already have a Lejerli account (§9: migrating people shouldn't
 * require one up front). Creates a pending Invite and emails a deep link;
 * membership itself is only created once the recipient accepts
 * (POST /invites/:token/accept), after logging in or signing up.
 */
router.post(
  '/:deskId/floor-invites',
  protect,
  [body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    try {
      const desk = await Desk.findById(req.params.deskId);
      if (!desk) {
        return res.status(404).json({ success: false, message: 'Desk not found.' });
      }

      if (desk.principalUserId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Only the Principal can invite floor members.' });
      }

      const invite = await createAndSendInvite({
        deskId: desk._id,
        deskName: desk.name,
        type: 'FLOOR',
        email: req.body.email,
        invitedByUserId: req.user._id,
        inviterName: req.user.displayName || req.user.email,
      });

      await AuditLog.create({
        deskId: desk._id,
        actorUserId: req.user._id,
        action: 'FLOOR_INVITE_SENT',
        entity: 'Invite',
        entityId: invite._id,
        newValue: { targetEmail: invite.targetEmail },
      });

      res.status(201).json({
        success: true,
        message: 'Invitation sent.',
        data: { id: invite._id, type: invite.type, targetEmail: invite.targetEmail, status: invite.status },
      });
    } catch (error) {
      console.error('floor invite error:', error.message);
      res.status(500).json({ success: false, message: 'Server error sending invite.' });
    }
  }
);

/**
 * POST /desks/:deskId/partner-invites
 * Principal-only. Invites a counterparty by email — same account-optional
 * flow as floor invites. The TradingRoom + Line/Backstage channels aren't
 * created until the invite is accepted.
 */
router.post(
  '/:deskId/partner-invites',
  protect,
  [body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    try {
      const desk = await Desk.findById(req.params.deskId);
      if (!desk) {
        return res.status(404).json({ success: false, message: 'Desk not found.' });
      }

      if (desk.principalUserId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Only the Principal can invite partners.' });
      }

      const invite = await createAndSendInvite({
        deskId: desk._id,
        deskName: desk.name,
        type: 'PARTNER',
        email: req.body.email,
        invitedByUserId: req.user._id,
        inviterName: req.user.displayName || req.user.email,
      });

      await AuditLog.create({
        deskId: desk._id,
        actorUserId: req.user._id,
        action: 'PARTNER_INVITE_SENT',
        entity: 'Invite',
        entityId: invite._id,
        newValue: { targetEmail: invite.targetEmail },
      });

      res.status(201).json({
        success: true,
        message: 'Invitation sent.',
        data: { id: invite._id, type: invite.type, targetEmail: invite.targetEmail, status: invite.status },
      });
    } catch (error) {
      console.error('partner invite error:', error.message);
      res.status(500).json({ success: false, message: 'Server error sending invite.' });
    }
  }
);

module.exports = router;
