const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const restHoursEntrySchema = new mongoose.Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
  startTime: { type: String, required: true }, // 'HH:mm', local to timezone
  endTime:   { type: String, required: true },
  timezone:  { type: String, required: true }, // IANA tz, e.g. 'Africa/Lagos'
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },

  // sha256(email) — lets the contacts-matching flow (§9) look up existing users
  // from a client-hashed contact list without ever seeing raw contact data.
  emailHash: { type: String, index: true },

  emailVerifiedAt: { type: Date, default: null },

  // bcrypt hash — never returned by default queries. Hashed exactly once,
  // in the pre-save hook below; routes must assign the PLAIN password here
  // and never call bcrypt themselves, or it gets hashed twice and every
  // login breaks.
  password: { type: String, required: true, select: false },

  displayName: { type: String, trim: true, default: '' },
  avatarUrl:   { type: String, default: null },

  // 0 = email verified, 1 = government ID + liveness. Tier 2 (business-verified)
  // lives on Desk, not User — see models/desk.js.
  verificationTier: { type: Number, enum: [0, 1], default: 0 },

  onDeskStatus: { type: String, enum: ['ON', 'OFF'], default: 'ON' },
  restHoursSchedule: { type: [restHoursEntrySchema], default: [] },

  // Optional, opt-in, captured separately from login (Settings/Desk setup).
  // Only used by the §8 SMS-escalation ladder (Step 6) — unrelated to auth.
  escalationPhone: { type: String, default: null },

  // Single field, not a Session collection — structurally enforces the Phase 1
  // single-device requirement. A new login/refresh overwrites this, invalidating
  // any prior refresh token. Never returned in API responses (select: false).
  refreshTokenHash: { type: String, default: null, select: false },

  // Failed password login attempts against this account.
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (this.isModified('email')) {
    this.emailHash = crypto.createHash('sha256').update(this.email).digest('hex');
  }
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// `this.password` requires the query to have used .select('+password') —
// select: false means it's absent by default.
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
