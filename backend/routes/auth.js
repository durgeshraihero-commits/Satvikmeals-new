const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

router.post('/google', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required.' });
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const { sub: googleId, email, name } = ticket.getPayload();

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ googleId, email, name, referredBy: referralCode || null });
      // Track in referrer's list
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email, name, joinedAt: new Date(), hasPurchased: false } } }
        );
      }
    } else if (!user.googleId) {
      user.googleId = googleId; await user.save();
    }

    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Authentication failed.' });
  }
});

router.get('/me', protect, (req, res) => {
  const u = req.user;
  res.json({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, referralCode: u.referralCode, coins: u.coins, subscriptions: u.subscriptions });
});

router.patch('/phone', protect, async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ message: 'Invalid phone.' });
  req.user.phone = phone; await req.user.save();
  res.json({ message: 'Phone saved.', phone });
});

module.exports = router;

// DEV LOGIN — local testing only, no real Google OAuth needed
// Remove this route before going to production
router.post('/dev-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Not available in production.' });
  }
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
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins }
    });
  } catch(err) {
    res.status(500).json({ message: 'Dev login failed.' });
  }
});
