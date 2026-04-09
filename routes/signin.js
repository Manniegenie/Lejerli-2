const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const User = require('../models/user');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 6 * 60 * 60 * 1000; // 6 hours

// POST /signin
router.post(
  '/',
  [
    body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').trim().notEmpty().withMessage('Password is required.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Check if account is locked
      if (user.lockUntil && user.lockUntil > Date.now()) {
        const minutesRemaining = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
        return res.status(423).json({
          success: false,
          message: `Account locked due to multiple failed attempts. Try again in ${minutesRemaining} minute(s).`,
          lockedUntil: new Date(user.lockUntil).toISOString(),
        });
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        const newAttempts = (user.loginAttempts || 0) + 1;
        user.loginAttempts = newAttempts;

        if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
          user.lockUntil = new Date(Date.now() + LOCK_TIME);
          await user.save();
          return res.status(423).json({
            success: false,
            message: 'Account locked due to too many failed attempts. Try again in 6 hours.',
            lockedUntil: user.lockUntil.toISOString(),
          });
        }

        await user.save();
        return res.status(401).json({
          success: false,
          message: `Invalid credentials. ${MAX_LOGIN_ATTEMPTS - newAttempts} attempt(s) remaining.`,
        });
      }

      // Reset attempts on success
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      const token = jwt.sign(
        { id: user._id, email: user.email, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const refreshToken = jwt.sign(
        { id: user._id },
        process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({
        success: true,
        message: 'Sign-in successful',
        data: {
          id: user._id,
          email: user.email,
          username: user.username,
          token,
          refreshToken,
        },
      });
    } catch (error) {
      console.error('Sign-in error:', error.message);
      res.status(500).json({ success: false, message: 'Server error during sign-in.' });
    }
  }
);

module.exports = router;
