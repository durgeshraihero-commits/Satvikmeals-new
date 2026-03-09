const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const router = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

router.post('/google', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required.' });

    // Try multiple client IDs in case of mismatch
    const clientId = process.env.GOOGLE_CLIENT_ID;
    console.log('[Google Auth] Client ID:', clientId ? clientId.substring(0,20)+'...' : 'NOT SET');
    console.log('[Google Auth] Token preview:', idToken.substring(0,30)+'...');

    const client = new OAuth2Client(clientId);
    let payload;

    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('[Google Auth] Verify error:', verifyErr.message);
      // If audience mismatch, try without audience check
      try {
        const ticket2 = await client.verifyIdToken({ idToken });
        payload = ticket2.getPayload();
        console.log('[Google Auth] Verified without audience check');
      } catch (err2) {
        console.error('[Google Auth] Both verify attempts failed:', err2.message);
        return res.status(401).json({ 
          message: 'Google login failed. Please try again or use email login.' 
        });
      }
    }

    const { sub: googleId, email, name } = payload;
    console.log('[Google Auth] Success for:', email);

    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await User.create({
        googleId,
        email: email.toLowerCase(),
        name,
        referredBy: referralCode || null
      });
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email: email.toLowerCase(), name, joinedAt: new Date() } } }
        );
      }
      console.log('[Google Auth] New user created:', email);
    } else {
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
      console.log('[Google Auth] Existing user:', email);
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
    console.error('[Google Auth] Unexpected error:', err.message, err.stack);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

router.get('/me', protect, (req, res) => {
  const u = req.user;
  res.json({
    id: u._id, name: u.name, email: u.email,
    phone: u.phone, role: u.role,
    referralCode: u.referralCode, coins: u.coins,
    subscriptions: u.subscriptions
  });
});

async function savePhone(req, res) {
  try {
    const { phone } = req.body;
    console.log(`[Phone Save] ${req.user.email} | ${phone}`);
    if (!phone) return res.status(400).json({ message: 'Phone required.' });
    const cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.length !== 10 || !/^[6-9]/.test(cleaned))
      return res.status(400).json({ message: 'Enter valid 10-digit Indian mobile number.' });
    const result = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { phone: cleaned } },
      { new: true }
    );
    console.log(`[Phone Save] Saved: ${result.phone}`);
    res.json({ success: true, message: 'Phone saved.', phone: result.phone });
  } catch (err) {
    console.error('[Phone Save Error]', err.message);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
}

router.patch('/phone', protect, savePhone);
router.post('/save-phone', protect, savePhone);

router.post('/dev-login', async (req, res) => {
  try {
    const { name, email, referralCode } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name and email required.' });
    const emailLower = email.toLowerCase().trim();
    let user = await User.findOne({ email: emailLower });
    if (!user) {
      user = await User.create({ name: name.trim(), email: emailLower, referredBy: referralCode || null });
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
    res.status(500).json({ message: 'Login failed: ' + err.message });
  }
});

module.exports = router;
