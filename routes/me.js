const express = require('express');
const router = express.Router();

const Desk = require('../models/desk');
const Partner = require('../models/partner');
const TradingRoom = require('../models/tradingRoom');
const RoomRoleAssignment = require('../models/roomRoleAssignment');
const FloorMembership = require('../models/floorMembership');
const Channel = require('../models/channel');
const User = require('../models/user');
const Message = require('../models/message');
const { protect } = require('../middleware/auth');
const { checkChannelPermission } = require('../middleware/permissions');

async function latestMessage(channelIds) {
  if (!channelIds.length) return null;
  return Message.findOne({ channelId: { $in: channelIds }, deletedAt: null }).sort({ createdAt: -1 });
}

/**
 * GET /me/chats
 * Unified list for the frontend's Chats tab: every TradingRoom the caller
 * can see (as Principal, role-assigned floor member, or connected partner)
 * plus every FLOOR channel on a desk the caller is an active member of.
 * Combined and sorted by most-recent activity, descending.
 */
router.get('/chats', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // ---- Gather every TradingRoom the caller has a stake in ----
    const principalDesks = await Desk.find({ principalUserId: userId }).select('_id');
    const principalDeskIds = principalDesks.map((d) => d._id);

    const roleAssignments = await RoomRoleAssignment.find({ userId }).select('roomId');
    const assignedRoomIds = roleAssignments.map((a) => a.roomId);

    const activePartners = await Partner.find({ userId, status: 'ACTIVE' }).select('_id');
    const partnerIds = activePartners.map((p) => p._id);

    const [roomsByDesk, roomsByAssignment, roomsByPartner] = await Promise.all([
      principalDeskIds.length ? TradingRoom.find({ deskId: { $in: principalDeskIds } }) : [],
      assignedRoomIds.length ? TradingRoom.find({ _id: { $in: assignedRoomIds } }) : [],
      partnerIds.length ? TradingRoom.find({ partnerId: { $in: partnerIds } }) : [],
    ]);

    const roomMap = new Map();
    for (const r of [...roomsByDesk, ...roomsByAssignment, ...roomsByPartner]) {
      roomMap.set(r._id.toString(), r);
    }
    const rooms = Array.from(roomMap.values());

    const deskCache = new Map();
    const partnerCache = new Map();
    const userCache = new Map();

    const roomItems = [];
    for (const room of rooms) {
      const deskKey = room.deskId.toString();
      let desk = deskCache.get(deskKey);
      if (desk === undefined) {
        desk = await Desk.findById(room.deskId);
        deskCache.set(deskKey, desk);
      }

      const partnerKey = room.partnerId.toString();
      let partner = partnerCache.get(partnerKey);
      if (partner === undefined) {
        partner = await Partner.findById(room.partnerId);
        partnerCache.set(partnerKey, partner);
      }

      if (!desk || !partner) continue;

      const isPartnerViewpoint = partner.userId.toString() === userId.toString();

      let title;
      if (isPartnerViewpoint) {
        // The caller IS the partner — show "who I'm talking to", i.e. the desk.
        title = desk.name;
      } else {
        const partnerUserKey = partner.userId.toString();
        let partnerUser = userCache.get(partnerUserKey);
        if (partnerUser === undefined) {
          partnerUser = await User.findById(partner.userId);
          userCache.set(partnerUserKey, partnerUser);
        }
        title = partnerUser ? (partnerUser.displayName || partnerUser.email) : 'Unknown partner';
      }

      // lastMessage is the most recent Message across whichever of this
      // room's channels the caller can actually read — Line/Backstage
      // isolation goes through checkChannelPermission, not a local check.
      const readableChannelIds = [];
      if (room.lineChannelId) {
        const perm = await checkChannelPermission(req.user, room.lineChannelId, 'read');
        if (perm.allowed) readableChannelIds.push(room.lineChannelId);
      }
      if (room.backstageChannelId) {
        const perm = await checkChannelPermission(req.user, room.backstageChannelId, 'read');
        if (perm.allowed) readableChannelIds.push(room.backstageChannelId);
      }

      const lastMsg = await latestMessage(readableChannelIds);

      roomItems.push({
        id: room._id,
        kind: 'ROOM',
        title,
        lastMessage: lastMsg,
        updatedAt: lastMsg ? lastMsg.createdAt : room.createdAt,
      });
    }

    // ---- FLOOR channels on desks the caller actively belongs to ----
    const memberships = await FloorMembership.find({ userId, status: 'ACTIVE' }).select('deskId');
    const memberDeskIds = memberships.map((m) => m.deskId);

    const floorChannels = memberDeskIds.length
      ? await Channel.find({ type: 'FLOOR', deskId: { $in: memberDeskIds } })
      : [];

    const floorItems = [];
    for (const channel of floorChannels) {
      const lastMsg = await Message.findOne({ channelId: channel._id, deletedAt: null }).sort({ createdAt: -1 });
      floorItems.push({
        id: channel._id,
        kind: 'FLOOR',
        title: `#${channel.name}`,
        lastMessage: lastMsg,
        updatedAt: lastMsg ? lastMsg.createdAt : channel.createdAt,
      });
    }

    const chats = [...roomItems, ...floorItems].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    res.status(200).json({ success: true, data: chats });
  } catch (error) {
    console.error('get /me/chats error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching chats.' });
  }
});

module.exports = router;
