const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');

const authRoutes = require('./src/routes/authRoutes');
const catalogRoutes = require('./src/routes/catalogRoutes');
const roomRoutes = require('./src/routes/roomRoutes');
const { requireAuth, requireAdmin } = require('./src/middleware/auth');

const app = express();
app.set('trust proxy', 1);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(helmet());
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.get('x-forwarded-proto') === 'http') {
    return res.redirect(`https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Try again later.' },
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/rooms', roomRoutes);
app.get('/api/admin/health', requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, role: req.user.role, user: req.user.username });
});

// Centralized error handler — catches anything thrown/rejected in a route
// that wasn't already turned into a response (e.g. malformed ObjectId).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

async function ensureAdminAccount() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminEmail || !adminPassword || adminPassword.length < 8) {
    throw new Error('ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD must be configured.');
  }

  const existing = await User.findOne({ $or: [{ email: adminEmail }, { username: adminUsername }] });

  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
    }
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await User.create({
    username: adminUsername,
    email: adminEmail,
    passwordHash,
    role: 'admin',
  });

  console.log(`Admin account ready for ${adminUsername}.`);
}

const PORT = process.env.PORT || 5000;

connectDB()
  .then(async () => {
    await ensureAdminAccount();
    app.listen(PORT, () => console.log(`Room Designer API listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
