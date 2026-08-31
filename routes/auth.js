const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const User = require('../models/user');
const EmailOTP = require('../models/emailOtp');
const { sendOtpEmail } = require('../services/EmailService');
const { protect } = require('../middleware/auth');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_OTP_ATTEMPTS = 5;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 6 * 60 * 60 * 1000; // 6 hours
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '7d';

function generateOtpCode(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
  return otp;
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

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
 * POST /auth/request-otp
 * Single entry point for both signup and login — find-or-create the user,
 * issue a fresh OTP, email it. The client never has to know in advance
 * whether an account exists.
 */
router.post(
  '/request-otp',
  [body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    const { email } = req.body;

    try {
      let user = await User.findOne({ email });
      const purpose = user ? 'LOGIN' : 'SIGNUP';

      if (user?.isLocked()) {
        const minutesRemaining = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
        return res.status(423).json({
          success: false,
          message: `Account locked due to multiple failed attempts. Try again in ${minutesRemaining} minute(s).`,
        });
      }

      const recentOtp = await EmailOTP.findOne({ email }).sort({ createdAt: -1 });
      if (recentOtp && Date.now() - recentOtp.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
        return res.status(429).json({ success: false, message: 'Please wait a moment before requesting another code.' });
      }

      if (!user) {
        user = await User.create({ email });
      }

      const code = generateOtpCode();
      await EmailOTP.create({
        email,
        codeHash: hashOtp(code),
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      });

      await sendOtpEmail(email, user.displayName, code, OTP_TTL_MS / 60000);

      res.status(200).json({ success: true, message: 'Verification code sent.', data: { purpose } });
    } catch (error) {
      console.error('request-otp error:', error.message);
      res.status(500).json({ success: false, message: 'Server error while sending verification code.' });
    }
  }
);

/**
 * POST /auth/verify-otp
 * Verifies the most recent OTP for the email and issues tokens.
 */
router.post(
  '/verify-otp',
  [
    body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    const { email, otp } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ success: false, message: 'No account found for this email.' });
      }

      if (user.isLocked()) {
        const minutesRemaining = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
        return res.status(423).json({
          success: false,
          message: `Account locked due to multiple failed attempts. Try again in ${minutesRemaining} minute(s).`,
        });
      }

      const otpRecord = await EmailOTP.findOne({ email }).sort({ createdAt: -1 });

      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        return res.status(401).json({ success: false, message: 'Verification code has expired. Request a new one.' });
      }

      if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
        return res.status(401).json({ success: false, message: 'Too many attempts. Request a new code.' });
      }

      if (otpRecord.codeHash !== hashOtp(otp)) {
        otpRecord.attempts += 1;
        await otpRecord.save();

        const newAttempts = (user.loginAttempts || 0) + 1;
        if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
          user.loginAttempts = newAttempts;
          user.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
          await user.save();
          return res.status(423).json({ success: false, message: 'Account locked due to too many failed attempts. Try again in 6 hours.' });
        }

        user.loginAttempts = newAttempts;
        await user.save();
        return res.status(401).json({ success: false, message: 'Invalid verification code.' });
      }

      // Success — consume the OTP, reset attempt counters.
      await EmailOTP.deleteMany({ email });
      user.loginAttempts = 0;
      user.lockUntil = null;
      if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();

      const { token, refreshToken } = issueTokens(user);
      user.refreshTokenHash = hashToken(refreshToken);
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Verified successfully.',
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
      console.error('verify-otp error:', error.message);
      res.status(500).json({ success: false, message: 'Server error during verification.' });
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
