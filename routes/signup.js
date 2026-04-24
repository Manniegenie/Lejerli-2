const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const User = require('../models/user');
const { sendEmailVerificationOTP } = require('../services/EmailService');

function generateOTP(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
  return otp;
}

// POST /signup
router.post(
  '/',
  [
    body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('username')
      .trim()
      .notEmpty().withMessage('Username is required.')
      .isLength({ min: 2, max: 50 }).withMessage('Username must be 2-50 characters.'),
    body('password')
      .trim()
      .isLength({ min: 7 }).withMessage('Password must be at least 7 characters.')
      .matches(/[!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\;'/]/).withMessage('Password must contain at least one special character.')
      .matches(/\d/).withMessage('Password must contain at least one digit.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    const { email, username, password } = req.body;

    try {
      const existingUser = await User.findOne({ $or: [{ email }, { username }] });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'User with this email or username already exists.' });
      }

      const skipVerification = process.env.SKIP_EMAIL_VERIFICATION === 'true';

      const otp = skipVerification ? null : generateOTP();
      const otpExpiresAt = skipVerification ? null : new Date(Date.now() + 10 * 60 * 1000);

      const user = await User.create({
        email, username, password,
        emailVerified: skipVerification,
        emailOTP: otp,
        emailOTPExpiresAt: otpExpiresAt,
      });

      if (!skipVerification) {
        sendEmailVerificationOTP(email, username, otp).catch(err =>
          console.error('OTP email failed (non-blocking):', err.message)
        );
      }

      res.status(201).json({
        success: true,
        message: 'Account created. Check your email for the verification code.',
        data: { id: user._id, email: user.email, username: user.username },
      });
    } catch (error) {
      console.error('Signup error:', error.message);
      res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
  }
);

module.exports = router;
