const mongoose = require('mongoose');

// Per-(room, user) role. No PRINCIPAL value here — the Principal's full-access-
// everywhere permission (§4) is derived from Desk.principalUserId at request
// time, not from a row in this collection (see middleware/permissions.js).
const roomRoleAssignmentSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'TradingRoom', required: true, index: true },
  deskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['LEAD', 'TRADER', 'OBSERVER'], required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'assignedAt', updatedAt: false } });

roomRoleAssignmentSchema.index({ roomId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('RoomRoleAssignment', roomRoleAssignmentSchema);
