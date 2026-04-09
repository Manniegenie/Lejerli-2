'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  TRADER: 'TRADER',
  OPS: 'OPS',
  AUDITOR: 'AUDITOR',
});

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
      index: true,
    },

    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false, // never returned in queries by default
    },

    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.TRADER,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastLoginAt: {
      type: Date,
    },

    loginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Instance methods ────────────────────────────────────────────────────

userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// ── Static methods ──────────────────────────────────────────────────────

userSchema.statics.hashPassword = async function (plain) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plain, salt);
};

// ── Pre-save hook ───────────────────────────────────────────────────────

userSchema.pre('save', async function (next) {
  if (this.isModified('passwordHash') && !this.passwordHash.startsWith('$2')) {
    // Only hash if it looks like plain text (not already a bcrypt hash)
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  }
  next();
});

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };
