const mongoose = require('mongoose');

// Membership fact only — "is this user on the desk's internal floor at all."
// Gates Floor Channel access (membership-only, no role distinction — confirmed
// during Step 2 review) and eligibility to be assigned a per-room role via
// RoomRoleAssignment. Does NOT itself carry a role — a member can hold
// different roles in different rooms (§4), which this table can't express.
const floorMembershipSchema = new mongoose.Schema({
  deskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['ACTIVE', 'REMOVED'], default: 'ACTIVE' },
  removedAt: { type: Date, default: null },
}, { timestamps: { createdAt: 'joinedAt', updatedAt: true } });

floorMembershipSchema.index({ deskId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('FloorMembership', floorMembershipSchema);
