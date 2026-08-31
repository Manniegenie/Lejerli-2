const TradingRoom = require('../models/tradingRoom');
const Desk = require('../models/desk');
const Partner = require('../models/partner');
const RoomRoleAssignment = require('../models/roomRoleAssignment');
const FloorMembership = require('../models/floorMembership');
const Channel = require('../models/channel');

// §4 permission matrix, minus the Principal row (handled by the
// Desk.principalUserId short-circuit below, not a role value here).
const ROOM_PERMISSIONS = {
  LEAD:     { read_line: true, post_line: true,  read_backstage: true, post_backstage: true,  blotter_read: true, blotter_write: true },
  TRADER:   { read_line: true, post_line: false, read_backstage: true, post_backstage: true,  blotter_read: true, blotter_write: true },
  OBSERVER: { read_line: true, post_line: false, read_backstage: true, post_backstage: false, blotter_read: true, blotter_write: false },
};

// A counterparty is never a floor member — read/post Line only, on their own room.
const PARTNER_PERMISSIONS = {
  read_line: true, post_line: true, read_backstage: false, post_backstage: false, blotter_read: false, blotter_write: false,
};

/**
 * Core permission check for a (user, room, action) triple — the plain-function
 * counterpart to requireRoomPermission below, callable outside of Express
 * (e.g. from checkChannelPermission, or the socket layer).
 *
 * Returns { allowed, role, room, desk }. When the room or desk can't be
 * found, `reason` is set to 'ROOM_NOT_FOUND' / 'DESK_NOT_FOUND' so the
 * Express wrapper can preserve the original 404-vs-403 status codes;
 * callers that only care about the boolean can ignore that field.
 */
async function checkRoomPermission(user, roomId, action) {
  const room = await TradingRoom.findById(roomId);
  if (!room) {
    return { allowed: false, role: null, reason: 'ROOM_NOT_FOUND' };
  }

  const desk = await Desk.findById(room.deskId);
  if (!desk) {
    return { allowed: false, role: null, reason: 'DESK_NOT_FOUND' };
  }

  const userId = user._id.toString();

  // Principal — full access to every room on their desk (§4 table row 1).
  // Derived from Desk.principalUserId, not a RoomRoleAssignment row.
  if (desk.principalUserId.toString() === userId) {
    return { allowed: true, role: 'PRINCIPAL', room, desk };
  }

  // Partner — Backstage is never queried for a partner-authenticated
  // request (§5: enforced at the transport layer, not just this check),
  // and access is scoped to this specific room only.
  const partner = await Partner.findById(room.partnerId);
  if (partner && partner.userId.toString() === userId && partner.status === 'ACTIVE') {
    if (!PARTNER_PERMISSIONS[action]) {
      return { allowed: false, role: 'PARTNER', room, desk };
    }
    return { allowed: true, role: 'PARTNER', room, desk };
  }

  // Floor member with a per-room role assignment — a user can hold
  // different roles in different rooms, so this is looked up per room.
  const assignment = await RoomRoleAssignment.findOne({ roomId: room._id, userId });
  if (!assignment) {
    return { allowed: false, role: null, room, desk };
  }

  const permissions = ROOM_PERMISSIONS[assignment.role];
  if (!permissions || !permissions[action]) {
    return { allowed: false, role: assignment.role, room, desk };
  }

  return { allowed: true, role: assignment.role, room, desk };
}

/**
 * Core membership check for a (user, desk) pair — Floor Channels are
 * membership-gated only, no role distinction (confirmed during Step 2
 * review: the §4 role table is scoped to trading rooms).
 */
async function checkFloorMembership(user, deskId) {
  const membership = await FloorMembership.findOne({
    deskId,
    userId: user._id,
    status: 'ACTIVE',
  });
  return { allowed: !!membership, membership: membership || null };
}

/**
 * Single access-control entry point for channel-scoped reads/writes — used
 * by both the REST message routes and the socket layer, so Line/Backstage
 * isolation lives in exactly one place. `mode` is 'read' | 'write'.
 *
 * LINE/BACKSTAGE channels dispatch into checkRoomPermission against the
 * channel's roomId; FLOOR channels dispatch into checkFloorMembership
 * against the channel's deskId.
 */
async function checkChannelPermission(user, channelId, mode) {
  const channel = await Channel.findById(channelId);
  if (!channel) {
    return { allowed: false, role: null, channel: null, reason: 'CHANNEL_NOT_FOUND' };
  }

  if (channel.type === 'LINE') {
    const action = mode === 'write' ? 'post_line' : 'read_line';
    const result = await checkRoomPermission(user, channel.roomId, action);
    return { ...result, channel };
  }

  if (channel.type === 'BACKSTAGE') {
    const action = mode === 'write' ? 'post_backstage' : 'read_backstage';
    const result = await checkRoomPermission(user, channel.roomId, action);
    return { ...result, channel };
  }

  if (channel.type === 'FLOOR') {
    const result = await checkFloorMembership(user, channel.deskId);
    return { allowed: result.allowed, role: result.allowed ? 'FLOOR_MEMBER' : null, channel };
  }

  return { allowed: false, role: null, channel, reason: 'UNKNOWN_CHANNEL_TYPE' };
}

/**
 * Express middleware factory enforcing the §4 permission matrix server-side.
 * Expects `protect` (middleware/auth.js) to have already set req.user, and
 * a :roomId route param. Thin wrapper around checkRoomPermission — same
 * external behavior (status codes, req.roomContext shape) as before the
 * core logic was extracted.
 *
 * action ∈ 'read_line' | 'post_line' | 'read_backstage' | 'post_backstage'
 *        | 'blotter_read' | 'blotter_write'
 */
function requireRoomPermission(action) {
  return async function (req, res, next) {
    try {
      const result = await checkRoomPermission(req.user, req.params.roomId, action);

      if (result.reason === 'ROOM_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Room not found' });
      }
      if (result.reason === 'DESK_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Desk not found' });
      }
      if (!result.allowed) {
        return res.status(403).json({ success: false, message: 'Not permitted' });
      }

      req.roomContext = { role: result.role, room: result.room, desk: result.desk };
      next();
    } catch (error) {
      console.error('requireRoomPermission error:', error.message);
      res.status(500).json({ success: false, message: 'Server error checking permissions' });
    }
  };
}

/**
 * Floor Channels are membership-gated only — no role distinction.
 * Expects a :deskId route param. Thin wrapper around checkFloorMembership.
 */
function requireFloorMembership() {
  return async function (req, res, next) {
    try {
      const result = await checkFloorMembership(req.user, req.params.deskId);
      if (!result.allowed) {
        return res.status(403).json({ success: false, message: 'Not a member of this desk' });
      }
      req.floorMembership = result.membership;
      next();
    } catch (error) {
      console.error('requireFloorMembership error:', error.message);
      res.status(500).json({ success: false, message: 'Server error checking membership' });
    }
  };
}

module.exports = {
  requireRoomPermission,
  requireFloorMembership,
  checkRoomPermission,
  checkFloorMembership,
  checkChannelPermission,
  ROOM_PERMISSIONS,
  PARTNER_PERMISSIONS,
};
