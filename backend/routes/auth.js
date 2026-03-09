const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const router = express.Router();

const client    = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ── Google OAuth ───────────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required.' });

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('Google token verify failed:', verifyErr.message);
      return res.status(401).json({ message: 'Google authentication failed. Please try again.' });
    }

    const { sub: googleId, email, name, picture } = payload;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // New user — create account
      user = await User.create({
        googleId,
        email: email.toLowerCase(),
        name,
        referredBy: referralCode || null
      });
      // Track referral
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email: email.toLowerCase(), name, joinedAt: new Date() } } }
        );
      }
    } else {
      // Existing user — update googleId if missing
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
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
    console.error('Google auth error:', err.message);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// ── Get current user ───────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  const u = req.user;
  res.json({
    id: u._id, name: u.name, email: u.email,
    phone: u.phone, role: u.role,
    referralCode: u.referralCode, coins: u.coins,
    subscriptions: u.subscriptions
  });
});

// ── Save phone — PATCH and POST both work ──────────────────────────────────
async function savePhone(req, res) {
  try {
    const { phone } = req.body;
    console.log(`[Phone Save] User: ${req.user.email} | Phone: ${phone}`);

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required.' });
    }

    const cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.length !== 10 || !/^[6-9]/.test(cleaned)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
    }

    // Direct MongoDB update — no validation middleware interference
    const result = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { phone: cleaned } },
      { new: true, strict: false }
    );

    if (!result) {
      return res.status(404).json({ message: 'User not found.' });
    }

    console.log(`[Phone Save] Saved: ${result.phone} for ${result.email}`);
    res.json({ success: true, message: 'Phone saved.', phone: result.phone });
  } catch (err) {
    console.error('[Phone Save Error]', err.message);
    res.status(500).json({ message: 'Server error saving phone. Please try again.' });
  }
}

router.patch('/phone', protect, savePhone);
router.post('/save-phone', protect, savePhone);

// ── Dev login ──────────────────────────────────────────────────────────────
router.post('/dev-login', async (req, res) => {
  try {
    const { name, email, referralCode } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name and email required.' });

    const emailLower = email.toLowerCase().trim();
    let user = await User.findOne({ email: emailLower });

    if (!user) {
      user = await User.create({
        name: name.trim(),
        email: emailLower,
        referredBy: referralCode || null
      });
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email: emailLower, name, joinedAt: new Date() } } }
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
    res.status(500).json({ message: 'Login failed: ' + err.message });
  }
});

module.exports = router;
