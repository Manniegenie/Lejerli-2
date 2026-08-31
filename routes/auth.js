const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const User = require('../models/user');
const { protect } = require('../middleware/auth');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 6 * 60 * 60 * 1000; // 6 hours
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '7d';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueTokens(user) {
  const token = jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
  return { token, refreshToken };
}

/**
 * POST /auth/signup
 * Creates the account and logs the user straight in — no separate email
 * verification step (that was OTP's job; email+password replaces it wholesale).
 */
router.post(
  '/signup',
  [
    body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('displayName').optional().trim().isLength({ max: 80 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    const { email, password, displayName } = req.body;

    try {
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      // Plain password assigned here — the pre-save hook in models/user.js
      // hashes it exactly once. Never call bcrypt in this route.
      const user = await User.create({
        email,
        password,
        displayName: displayName || '',
        emailVerifiedAt: new Date(),
      });

      const { token, refreshToken } = issueTokens(user);
      user.refreshTokenHash = hashToken(refreshToken);
      await user.save();

      res.status(201).json({
        success: true,
        message: 'Account created.',
        data: {
          id: user._id,
          email: user.email,
          displayName: user.displayName,
          verificationTier: user.verificationTier,
          token,
          refreshToken,
        },
      });
    } catch (error) {
      console.error('signup error:', error.message);
      res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
  }
);

/**
 * POST /auth/login
 */
router.post(
  '/login',
  [
    body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email }).select('+password');
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      if (user.isLocked()) {
        const minutesRemaining = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
        return res.status(423).json({
          success: false,
          message: `Account locked due to multiple failed attempts. Try again in ${minutesRemaining} minute(s).`,
        });
      }

      const matches = await user.comparePassword(password);
      if (!matches) {
        const newAttempts = (user.loginAttempts || 0) + 1;
        if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
          user.loginAttempts = newAttempts;
          user.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
          await user.save();
          return res.status(423).json({ success: false, message: 'Account locked due to too many failed attempts. Try again in 6 hours.' });
        }

        user.loginAttempts = newAttempts;
        await user.save();
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      user.loginAttempts = 0;
      user.lockUntil = null;

      const { token, refreshToken } = issueTokens(user);
      user.refreshTokenHash = hashToken(refreshToken);
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Logged in.',
        data: {
          id: user._id,
          email: user.email,
          displayName: user.displayName,
          verificationTier: user.verificationTier,
          token,
          refreshToken,
        },
      });
    } catch (error) {
      console.error('login error:', error.message);
      res.status(500).json({ success: false, message: 'Server error during login.' });
    }
  }
);

/**
 * POST /auth/refresh
 * Rotates both tokens — single-device model means this overwrites
 * refreshTokenHash, so only the most recently issued refresh token works.
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'refreshToken is required.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+refreshTokenHash');

    if (!user || user.refreshTokenHash !== hashToken(refreshToken)) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }

    const tokens = issueTokens(user);
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    await user.save();

    res.status(200).json({ success: true, data: tokens });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
  }
});

/**
 * GET /auth/me
 */
router.get('/me', protect, async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      id: req.user._id,
      email: req.user.email,
      displayName: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
      verificationTier: req.user.verificationTier,
      onDeskStatus: req.user.onDeskStatus,
    },
  });
});

module.exports = router;
