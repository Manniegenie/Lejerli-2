const mongoose = require('mongoose');

// An external connection — never a floor member. Phase 1 constraint: desk<->
// individual only (no partnerDeskId field — desk<->desk is Phase 2, §10, and
// deliberately left unmodeled rather than half-reserved).
const partnerSchema = new mongoose.Schema({
  deskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'BLOCKED'], default: 'PENDING' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  connectedAt: { type: Date, default: null },
}, { timestamps: true });

partnerSchema.index({ deskId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Partner', partnerSchema);
