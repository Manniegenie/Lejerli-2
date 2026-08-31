const mongoose = require('mongoose');
const crypto = require('crypto');

const inviteSchema = new mongoose.Schema({
  deskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Desk', required: true, index: true },
  type: { type: String, enum: ['FLOOR', 'PARTNER'], required: true },

  invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetEmail: { type: String, required: true, lowercase: true, trim: true },

  token: { type: String, required: true, unique: true, default: () => crypto.randomBytes(24).toString('hex') },
  deepLink: { type: String, default: null },

  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'EXPIRED'], default: 'PENDING' },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Invite', inviteSchema);
