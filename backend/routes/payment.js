const express = require('express');
const axios   = require('axios');
const { protect, requirePhone } = require('../middleware/auth');
const { Payment, Order, Plan }  = require('../models/index');
const User = require('../models/User');
const { sendTelegramMessage } = require('../utils/telegram');
const router = express.Router();

const IMOJO = () => process.env.INSTAMOJO_BASE_URL || 'https://test.instamojo.com/api/1.1';
const iHeaders = () => ({
  'X-Api-Key':    process.env.INSTAMOJO_API_KEY,
  'X-Auth-Token': process.env.INSTAMOJO_AUTH_TOKEN,
  'Content-Type': 'application/x-www-form-urlencoded'
});

// POST /api/payment/create
router.post('/create', protect, requirePhone, async (req, res) => {
  try {
    const { planId, useCoins } = req.body;
    if (!planId) return res.status(400).json({ message: 'planId required.' });

    const plan = await Plan.findById(planId);
    if (!plan || !plan.isActive) return res.status(404).json({ message: 'Plan not found.' });

    const user = req.user;
    let finalAmount = plan.price;
    let coinsUsed   = 0;

    // Apply coins discount (1 coin = Re 1, max 50% discount)
    if (useCoins && user.coins > 0) {
      const maxDiscount = Math.floor(plan.price * 0.5);
      coinsUsed   = Math.min(user.coins, maxDiscount);
      finalAmount = plan.price - coinsUsed;
    }

    if (finalAmount < 1) finalAmount = 1;

    const params = new URLSearchParams({
      purpose:      `SatvikMeals - ${plan.name}`,
      amount:       String(finalAmount),
      buyer_name:   user.name,
      email:        user.email,
      phone:        user.phone,
      redirect_url: `${process.env.BASE_URL}/payment-success.html`,
      send_email:   'false',
      send_sms:     'false',
      allow_repeated_payments: 'false'
    });

    const response = await axios.post(`${IMOJO()}/payment-requests/`, params.toString(), { headers: iHeaders() });
    const pr = response.data.payment_request;
    if (!pr?.longurl) return res.status(502).json({ message: 'Instamojo error.' });

    await Payment.create({
      email: user.email, amount: finalAmount,
      purpose: `SatvikMeals - ${plan.name}`,
      requestId: pr.id, status: 'pending',
      source: 'subscription', planId: plan._id, coinsUsed
    });

    res.json({ paymentUrl: pr.longurl, requestId: pr.id, finalAmount, coinsUsed });
  } catch (err) {
    console.error('Payment create:', err?.response?.data || err.message);
    res.status(500).json({ message: 'Payment initiation failed.' });
  }
});

// POST /api/payment/verify
router.post('/verify', protect, async (req, res) => {
  try {
    const { payment_id, payment_request_id } = req.body;
    if (!payment_id || !payment_request_id) return res.status(400).json({ message: 'Missing fields.' });

    const response = await axios.get(`${IMOJO()}/payment-requests/${payment_request_id}/`, { headers: iHeaders() });
    const pr = response.data.payment_request;
    if (!pr) return res.status(502).json({ message: 'Cannot verify with Instamojo.' });

    const match = (pr.payments || []).find(p => p.payment_id === payment_id);
    if (!match || match.status !== 'Credit') {
      await Payment.findOneAndUpdate({ requestId: payment_request_id }, { status: 'failed', paymentId: payment_id });
      return res.status(400).json({ message: 'Payment not successful.' });
    }

    const payRec = await Payment.findOneAndUpdate(
      { requestId: payment_request_id },
      { status: 'paid', paymentId: payment_id },
      { new: true }
    );
    if (!payRec) return res.status(404).json({ message: 'Payment record not found.' });

    // Deduct coins if used
    if (payRec.coinsUsed > 0) {
      await User.findOneAndUpdate({ email: req.user.email }, { $inc: { coins: -payRec.coinsUsed } });
    }

    const plan = await Plan.findById(payRec.planId);
    const order = await Order.create({
      userEmail: req.user.email,
      items: [{ name: payRec.purpose, quantity: 1, price: payRec.amount }],
      totalAmount: payRec.amount,
      paymentId: payment_id,
      paymentStatus: 'paid',
      planId: payRec.planId
    });

    // Activate subscription
    if (plan) {
      const now = new Date();
      const end = new Date(now);
      end.setDate(now.getDate() + (plan.validityDays || (plan.type === 'weekly' ? 7 : 30)));
      await User.findOneAndUpdate(
        { email: req.user.email },
        { $push: { subscriptions: {
          planId: plan._id, planName: plan.name, planType: plan.type,
          startDate: now, endDate: end, status: 'active', paymentId: payment_id
        }}}
      );

      // Referral reward: monthly plan → referrer gets 100 coins
      if (plan.type === 'monthly' && req.user.referredBy) {
        const referrer = await User.findOne({ referralCode: req.user.referredBy });
        if (referrer) {
          // Check not already rewarded
          const ref = referrer.referredUsers.find(r => r.email === req.user.email);
          if (ref && !ref.rewardPaid) {
            await User.findOneAndUpdate(
              { referralCode: req.user.referredBy, 'referredUsers.email': req.user.email },
              { $inc: { coins: 100 }, $set: { 'referredUsers.$.rewardPaid': true, 'referredUsers.$.hasPurchased': true, 'referredUsers.$.planName': plan.name } }
            );
            await sendTelegramMessage(
              `REFERRAL REWARD\n\n${referrer.name} earned 100 coins!\nNew user ${req.user.name} purchased ${plan.name}`
            );
          }
        }
      }
    }

    // Mark referred user as purchased (update referrer's list)
    if (req.user.referredBy) {
      await User.findOneAndUpdate(
        { referralCode: req.user.referredBy, 'referredUsers.email': req.user.email },
        { $set: { 'referredUsers.$.hasPurchased': true, 'referredUsers.$.planName': plan?.name } }
      );
    }

    // Telegram notification
    await sendTelegramMessage(
      `NEW ORDER CONFIRMED\n\n` +
      `Customer: ${req.user.name}\nEmail: ${req.user.email}\nPhone: ${req.user.phone}\n` +
      `Plan: ${plan?.name || 'Unknown'}\nAmount Paid: Rs ${payRec.amount}` +
      (payRec.coinsUsed ? `\nCoins Used: ${payRec.coinsUsed}` : '') +
      `\nOrder ID: ${order._id}`
    );

    res.json({ message: 'Payment verified. Subscription activated.', orderId: order._id });
  } catch (err) {
    console.error('Payment verify:', err?.response?.data || err.message);
    res.status(500).json({ message: 'Verification failed.' });
  }
});

module.exports = router;
