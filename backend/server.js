require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mongoose = require('mongoose');

const authRoutes      = require('./routes/auth');
const paymentRoutes   = require('./routes/payment');
const planRoutes      = require('./routes/plans');
const menuRoutes      = require('./routes/menu');
const userRoutes      = require('./routes/user');
const adminRoutes     = require('./routes/admin');
const orderRoutes     = require('./routes/orders');
const complaintRoutes = require('./routes/complaints');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth',      authRoutes);
app.use('/api/payment',   paymentRoutes);
app.use('/api/plans',     planRoutes);
app.use('/api/menu',      menuRoutes);
app.use('/api/user',      userRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/orders',    orderRoutes);
app.use('/api',           complaintRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT || 5000, () =>
      console.log(`SatvikMeals API running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error(err); process.exit(1); });
