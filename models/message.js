const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  state:  { type: String, enum: ['SENT', 'DELIVERED', 'READ'], required: true },
  at:     { type: Date, default: Date.now },
}, { _id: false });

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emoji:  { type: String, required: true },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
  senderId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  type: { type: String, enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'VOICE', 'SYSTEM'], default: 'TEXT' },

  // All three sub-fields exist from Step 2 even though only `text` is populated
  // until the Step 4 libsignal integration — this way that migration only
  // changes which sub-field gets written/read, not the schema shape.
  body: {
    text:       { type: String, default: null },
    mediaUrl:   { type: String, default: null },
    ciphertext: { type: Buffer, default: null },
  },

  replyToMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  mentions: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  reactions: { type: [reactionSchema], default: [] },

  // Embedded rather than a separate collection — acceptable given room sizes
  // are small (a trading room is desk-assigned members + one partner; floor
  // channels cap at ~200 per §7).
  receipts: { type: [receiptSchema], default: [] },

  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

messageSchema.index({ channelId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
