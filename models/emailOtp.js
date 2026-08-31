const mongoose = require('mongoose');

// Kept as its own collection (not embedded on User) so an unverified
// signup attempt never leaves a partial User document behind.
const emailOtpSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true, trim: true, index: true },
  codeHash:  { type: String, required: true }, // sha256(code) — never store plaintext
  purpose:   { type: String, enum: ['SIGNUP', 'LOGIN'], required: true },
  attempts:  { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// Auto-clean expired OTPs.
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailOTP', emailOtpSchema);
