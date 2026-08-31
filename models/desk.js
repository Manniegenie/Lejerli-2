const mongoose = require('mongoose');

const tradingHoursEntrySchema = new mongoose.Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  startTime: { type: String, required: true },
  endTime:   { type: String, required: true },
  timezone:  { type: String, required: true },
}, { _id: false });

const deskSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },

  // The creator/owner — exactly one per desk. Full access to every room on the
  // desk is derived from this field at request time (see middleware/permissions.js),
  // not from a role row, so it can never drift out of sync.
  principalUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // 0/1 mirror User.verificationTier at desk-creation time conceptually, but this
  // field is desk-level: 2 = business-verified. Field only — no flow — per §3/§10.
  verificationTier: { type: Number, enum: [0, 1, 2], default: 0 },

  // Principal-set, desk-wide default rest hours (§8). Composes with each member's
  // own User.restHoursSchedule; exact precedence is a Step 6 concern, not modeled here.
  tradingHoursTemplate: { type: [tradingHoursEntrySchema], default: [] },

  // Desk-level prepaid credits for SMS escalation (§8/§9) — spent by Step 6's
  // escalation ladder, not touched by anything in Step 2/3.
  smsCreditBalance: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Desk', deskSchema);
