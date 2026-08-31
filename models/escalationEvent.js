const mongoose = require('mongoose');

// Scarcity ("one in-app urgent per sender per counterparty per day") is
// enforced by querying this collection at write time, not by a counter field.
const escalationEventSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'TradingRoom', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  tier: { type: String, enum: ['IN_APP_URGENT', 'SMS'], required: true },
  smsCreditsCharged: { type: Number, default: 0 },
}, { timestamps: { createdAt: 'sentAt', updatedAt: false } });

module.exports = mongoose.model('EscalationEvent', escalationEventSchema);
