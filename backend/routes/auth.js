const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const router = express.Router();

const client   = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Google OAuth
router.post('/google', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required.' });

    const ticket = await client.verifyIdToken({
      idToken, audience: process.env.GOOGLE_CLIENT_ID
    });
    const { sub: googleId, email, name } = ticket.getPayload();

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ googleId, email, name, referredBy: referralCode || null });
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email, name, joinedAt: new Date() } } }
        );
      }
    } else if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }

    const token = signToken(user._id);
    res.json({
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        referralCode: user.referralCode, coins: user.coins
      }
    });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ message: 'Authentication failed.' });
  }
});

// Get current user
router.get('/me', protect, (req, res) => {
  const u = req.user;
  res.json({
    id: u._id, name: u.name, email: u.email,
    phone: u.phone, role: u.role,
    referralCode: u.referralCode, coins: u.coins,
    subscriptions: u.subscriptions
  });
});

// Save phone number — FIXED: uses findByIdAndUpdate to ensure it persists
router.patch('/phone', protect, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number required.' });
    if (!/^[6-9]\d{9}$/.test(phone))
      return res.status(400).json({ message: 'Enter valid 10-digit Indian mobile number.' });

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { phone } },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: 'User not found.' });

    console.log('Phone saved for', updated.email, ':', updated.phone);
    res.json({ message: 'Phone saved successfully.', phone: updated.phone });
  } catch (err) {
    console.error('Phone save error:', err.message);
    res.status(500).json({ message: 'Failed to save phone. Try again.' });
  }
});

// Dev login (local testing only)
router.post('/dev-login', async (req, res) => {
  try {
    const { name, email, referralCode } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name and email required.' });

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ name, email, referredBy: referralCode || null });
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email, name, joinedAt: new Date() } } }
        );
      }
    }

    const token = signToken(user._id);
    res.json({
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        referralCode: user.referralCode, coins: user.coins
      }
    });
  } catch (err) {
    console.error('Dev login error:', err.message);
    res.status(500).json({ message: 'Login failed.' });
  }
});

module.exports = router;
