const mongoose = require('mongoose');

// A Channel is the generic messaging surface underlying Line, Backstage, and
// Floor Channels. LINE/BACKSTAGE belong to a TradingRoom; FLOOR belongs to a Desk.
const channelSchema = new mongoose.Schema({
  type: { type: String, enum: ['LINE', 'BACKSTAGE', 'FLOOR'], required: true },

  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'TradingRoom', default: null, index: true },
  deskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', default: null, index: true },

  name: { type: String, trim: true, default: null }, // Floor Channels only

  // Per-chat disappearing-messages setting (§5). Null = disabled.
  disappearingMessagesTTL: { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Channel', channelSchema);
