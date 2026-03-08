const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { Plan, Menu, Order, Payment } = require('../models/index');
const User = require('../models/User');
const router = express.Router();
router.use(protect, adminOnly);

// PLANS
router.get('/plans',        async (req, res) => res.json(await Plan.find().sort('sortOrder')));
router.post('/plans',       async (req, res) => { try { res.status(201).json(await Plan.create(req.body)); } catch(e){ res.status(400).json({message:e.message}); }});
router.put('/plans/:id',    async (req, res) => { const p = await Plan.findByIdAndUpdate(req.params.id, req.body, {new:true}); p ? res.json(p) : res.status(404).json({message:'Not found'}); });
router.delete('/plans/:id', async (req, res) => { await Plan.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); });

// MENU
router.get('/menu', async (req, res) => res.json(await Menu.find().sort('-weekStarting').limit(8)));
router.post('/menu', async (req, res) => { try { res.status(201).json(await Menu.create(req.body)); } catch(e){ res.status(400).json({message:e.message}); }});
router.put('/menu/:id', async (req, res) => { const m = await Menu.findByIdAndUpdate(req.params.id, req.body, {new:true}); m ? res.json(m) : res.status(404).json({message:'Not found'}); });
router.delete('/menu/:id', async (req, res) => { await Menu.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); });

// DASHBOARD STATS
router.get('/dashboard', async (req, res) => {
  const [totalUsers, totalOrders, rev, recentOrders, recentUsers] = await Promise.all([
    User.countDocuments(),
    Order.countDocuments({paymentStatus:'paid'}),
    Payment.aggregate([{$match:{status:'paid'}},{$group:{_id:null,total:{$sum:'$amount'}}}]),
    Order.find({paymentStatus:'paid'}).sort('-createdAt').limit(10),
    User.find().sort('-createdAt').limit(10).select('name email phone createdAt coins')
  ]);
  res.json({ totalUsers, totalOrders, totalRevenue: rev[0]?.total||0, recentOrders, recentUsers });
});

router.get('/users',    async (req, res) => { const u = await User.find().sort('-createdAt').select('-__v'); res.json(u); });
router.get('/orders',   async (req, res) => { const o = await Order.find().sort('-createdAt'); res.json(o); });
router.get('/payments', async (req, res) => { const p = await Payment.find().sort('-createdAt'); res.json(p); });

module.exports = router;
