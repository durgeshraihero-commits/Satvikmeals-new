const express = require('express');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();
router.use(protect);

router.get('/dashboard', async (req, res) => {
  const user = await User.findById(req.user._id).select('-__v');
  res.json({
    name: user.name, email: user.email, phone: user.phone,
    referralCode: user.referralCode, coins: user.coins,
    subscriptions: user.subscriptions, referredUsers: user.referredUsers,
    createdAt: user.createdAt
  });
});

router.post('/subscription/:subId/pause', async (req, res) => {
  const user = await User.findById(req.user._id);
  const sub  = user.subscriptions.id(req.params.subId);
  if (!sub) return res.status(404).json({ message: 'Not found.' });
  if (sub.status !== 'active') return res.status(400).json({ message: 'Not active.' });
  sub.status = 'paused'; sub.pausedAt = new Date();
  await user.save(); res.json({ message: 'Subscription paused.', subscription: sub });
});

router.post('/subscription/:subId/resume', async (req, res) => {
  const user = await User.findById(req.user._id);
  const sub  = user.subscriptions.id(req.params.subId);
  if (!sub) return res.status(404).json({ message: 'Not found.' });
  if (sub.status !== 'paused') return res.status(400).json({ message: 'Not paused.' });
  const days = Math.floor((Date.now() - sub.pausedAt) / 86400000);
  sub.endDate = new Date(sub.endDate.getTime() + days * 86400000);
  sub.status = 'active'; sub.pausedAt = undefined;
  await user.save(); res.json({ message: 'Subscription resumed.', subscription: sub });
});

module.exports = router;
