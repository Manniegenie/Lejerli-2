const mongoose = require('mongoose');

const tradingRoomSchema = new mongoose.Schema({
  deskId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', required: true, index: true },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },

  lineChannelId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },
  backstageChannelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },

  // Timestamp the counterparty's client confirmed the §5 disclosure notice was
  // shown. Binds the notice to this room rather than being a one-time global flag.
  disclosureAcknowledgedAt: { type: Date, default: null },
}, { timestamps: true });

tradingRoomSchema.index({ deskId: 1, partnerId: 1 }, { unique: true });

module.exports = mongoose.model('TradingRoom', tradingRoomSchema);
