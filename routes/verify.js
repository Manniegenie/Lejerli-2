const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/user');

// POST /verify
router.post('/', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ success: false, message: 'Email already verified.' });
    }

    if (!user.emailOTP || user.emailOTP !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid verification code.' });
    }

    if (user.emailOTPExpiresAt < new Date()) {
      return res.status(401).json({ success: false, message: 'Verification code has expired.' });
    }

    user.emailVerified = true;
    user.emailOTP = null;
    user.emailOTPExpiresAt = null;
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
      message: 'Email verified successfully.',
      data: {
        id: user._id,
        email: user.email,
        username: user.username,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Verify error:', error.message);
    res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
});

module.exports = router;
