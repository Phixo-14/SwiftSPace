const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const User = require('../models/User');
const Room = require('../models/Room');
const CatalogItem = require('../models/CatalogItem');
const RoomTimer = require('../models/RoomTimer');
const PlacementError = require('../models/PlacementError');
const getFirebaseAdmin = require('../config/firebaseAdmin');

const mailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  })
  : null;

function createVerificationCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function sendVerificationCode(user, code) {
  const message = {
    from: process.env.RESEND_FROM || process.env.SMTP_FROM,
    to: user.email,
    subject: 'Verify your Studio Grid email',
    text: `Your Studio Grid verification code is ${code}. It expires in 10 minutes.`,
  };

  const resendConfigured = process.env.RESEND_API_KEY
    && !process.env.RESEND_API_KEY.startsWith('replace-with-');

  if (resendConfigured) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      return true;
    } catch (error) {
      console.error(`Could not send verification email to ${user.email}: ${error.message}`);
      console.warn(`Email verification code for ${user.email}: ${code}`);
      return false;
    }
  }

  if (!mailTransport) {
    console.warn(`Email verification code for ${user.email}: ${code}`);
    return false;
  }

  try {
    await mailTransport.sendMail(message);
    return true;
  } catch (error) {
    console.error(`Could not send verification email to ${user.email}: ${error.code || error.message}`);
    console.warn(`Email verification code for ${user.email}: ${code}`);
    return false;
  }
}

async function issueVerificationCode(user) {
  const code = createVerificationCode();
  user.emailVerificationCodeHash = hashVerificationCode(code);
  user.emailVerificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  return sendVerificationCode(user, code);
}

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username, role: user.role || 'user' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
async function register(req, res) {
  const { username, email, password } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    if (existing.role !== 'user' || existing.emailVerified) {
      return res.status(409).json({ message: 'A user with that email or username already exists.' });
    }
    await existing.deleteOne();
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const code = createVerificationCode();
  const user = await User.create({
    username,
    email,
    passwordHash,
    emailVerified: false,
    emailVerificationCodeHash: hashVerificationCode(code),
    emailVerificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  const delivered = await sendVerificationCode(user, code);
  res.status(201).json({
    message: delivered
      ? 'Verification code sent.'
      : 'Email could not be delivered. Check the backend terminal for the verification code.',
    email: user.email,
    ...(process.env.NODE_ENV !== 'production' ? { developmentCode: code } : {}),
  });
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (user.role !== 'admin' && !user.emailVerified) {
      return res.status(403).json({ message: 'Please verify your email before signing in.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role || 'user' },
    });
  } catch (error) {
    console.error(`Login failed for ${email}:`, error);
    res.status(500).json({ message: 'Login service error. Check the backend logs.' });
  }
}

// POST /api/auth/firebase-sync — verifies a Firebase email-link identity and syncs it to MongoDB.
async function firebaseSync(req, res) {
  const firebase = getFirebaseAdmin();
  let decoded;
  if (firebase) {
    try {
      decoded = await firebase.auth().verifyIdToken(req.body.idToken);
    } catch {
      return res.status(401).json({ message: 'Invalid Firebase authentication token.' });
    }
  } else if (process.env.FIREBASE_WEB_API_KEY) {
    try {
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: req.body.idToken }),
        }
      );
      const result = await response.json();
      const account = result.users?.[0];
      if (!response.ok || !account) throw new Error('Firebase token lookup failed.');
      decoded = { uid: account.localId, email: account.email, email_verified: account.emailVerified };
    } catch {
      return res.status(401).json({ message: 'Invalid Firebase authentication token.' });
    }
  } else {
    return res.status(503).json({ message: 'Firebase server configuration is missing.' });
  }
  if (!decoded.email || !decoded.email_verified) {
    return res.status(403).json({ message: 'Please verify your email with Firebase first.' });
  }

  let user = await User.findOne({ $or: [{ firebaseUid: decoded.uid }, { email: decoded.email }] });
  if (!user) {
    user = await User.create({
      username: req.body.username,
      email: decoded.email,
      firebaseUid: decoded.uid,
      passwordHash: crypto.randomBytes(32).toString('hex'),
      emailVerified: true,
      role: 'user',
    });
  } else {
    user.firebaseUid = decoded.uid;
    user.emailVerified = true;
    await user.save();
  }

  const token = signToken(user);
  res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
}

async function syncFirebaseUsersFromFirebase() {
  const firebase = getFirebaseAdmin();
  if (!firebase) {
    throw new Error('Firebase Admin credentials are not configured.');
  }

  let page;
  let synced = 0;
  let skipped = 0;
  do {
    page = await firebase.auth().listUsers(1000, page?.pageToken);
    for (const firebaseUser of page.users) {
      if (!firebaseUser.email) {
        skipped += 1;
        continue;
      }

      let user = await User.findOne({
        $or: [{ firebaseUid: firebaseUser.uid }, { email: firebaseUser.email.toLowerCase() }],
      });
      if (!user) {
        const baseUsername = (firebaseUser.displayName || firebaseUser.email.split('@')[0])
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 24) || 'user';
        let username = baseUsername;
        let suffix = 1;
        while (await User.exists({ username })) {
          username = `${baseUsername.slice(0, 30 - String(suffix).length)}${suffix}`;
          suffix += 1;
        }
        user = new User({
          username,
          email: firebaseUser.email,
          firebaseUid: firebaseUser.uid,
          passwordHash: crypto.randomBytes(32).toString('hex'),
          role: 'user',
        });
      }

      user.firebaseUid = firebaseUser.uid;
      user.email = firebaseUser.email;
      user.emailVerified = firebaseUser.emailVerified;
      await user.save();
      synced += 1;
    }
  } while (page.pageToken);

  return { synced, skipped };
}

// POST /api/auth/admin/sync-firebase-users — imports all Firebase accounts into MongoDB.
async function syncFirebaseUsers(req, res) {
  try {
    const result = await syncFirebaseUsersFromFirebase();
    res.json({ message: 'Firebase users synchronized.', ...result });
  } catch (error) {
    console.error(`Firebase user synchronization failed: ${error.message}`);
    res.status(503).json({ message: error.message });
  }
}

// POST /api/auth/admins — requires an existing admin token.
async function createAdmin(req, res) {
  const { username, email, password } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    return res.status(409).json({ message: 'A user with that email or username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username, email, passwordHash, role: 'admin' });

  res.status(201).json({
    user: { id: user._id, username: user.username, email: user.email, role: user.role },
  });
}

// POST /api/auth/users — requires an existing admin token.
async function createUser(req, res) {
  const { username, email, password } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    return res.status(409).json({ message: 'A user with that email or username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username, email, passwordHash, role: 'user', emailVerified: true });

  res.status(201).json({
    user: { id: user._id, username: user.username, email: user.email, role: user.role },
  });
}

// POST /api/auth/verify-email
async function verifyEmail(req, res) {
  const { email, code } = req.body;
  const user = await User.findOne({ email, emailVerified: false });
  if (!user) {
    return res.status(400).json({ message: 'Invalid or expired verification code.' });
  }
  if (user.emailVerificationExpiresAt < new Date()
    || !crypto.timingSafeEqual(
      Buffer.from(user.emailVerificationCodeHash),
      Buffer.from(hashVerificationCode(code))
    )) {
    return res.status(400).json({ message: 'Invalid or expired verification code.' });
  }

  user.emailVerified = true;
  user.emailVerificationCodeHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();
  const token = signToken(user);
  res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
}

// POST /api/auth/resend-verification
async function resendVerification(req, res) {
  const user = await User.findOne({ email: req.body.email, emailVerified: false });
  if (user) {
    const code = createVerificationCode();
    user.emailVerificationCodeHash = hashVerificationCode(code);
    user.emailVerificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    const delivered = await sendVerificationCode(user, code);
    return res.json({
      message: delivered ? 'A new verification code was sent.' : 'Email delivery failed. Use the local code shown.',
      ...(!delivered || process.env.NODE_ENV !== 'production' ? { developmentCode: code } : {}),
    });
  }
  res.json({ message: 'If that account needs verification, a new code was sent.' });
}

// DELETE /api/auth/users/:id — requires an existing admin token.
async function deleteUser(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own admin account.' });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.role === 'admin') {
    return res.status(400).json({ message: 'Admin accounts cannot be deleted as regular users.' });
  }

  await Promise.all([
    Room.deleteMany({ userId: user._id }),
    RoomTimer.deleteMany({ userId: user._id }),
    PlacementError.deleteMany({ userId: user._id }),
    user.deleteOne(),
  ]);
  res.status(204).send();
}

// GET /api/auth/admin/overview — requires an existing admin token.
async function getAdminOverview(req, res) {
  const [users, rooms, catalogItems, catalogCategoryItems, allRooms, timers, placementErrors] = await Promise.all([
    User.find().select('_id username email role createdAt').sort({ role: 1, createdAt: -1 }),
    Room.find().select('roomName dimensions userId createdAt updatedAt').populate('userId', 'username email').sort({ updatedAt: -1 }).limit(8),
    CatalogItem.countDocuments(),
    CatalogItem.find().select('category'),
    Room.find()
      .select('roomName dimensions placedItems createdAt userId')
      .populate('userId', 'username'),
    RoomTimer.find(),
    PlacementError.find().populate('catalogItemId', 'name'),
  ]);

  const timerByRoom = new Map(timers.map((timer) => [timer.roomId.toString(), Number(timer.seconds) || 0]));
  const recentRooms = rooms.map((room) => ({
    ...room.toObject(),
    timerSeconds: timerByRoom.get(room._id.toString()) ?? 0,
  }));

  const totalPlacements = allRooms.reduce((total, room) => total + room.placedItems.length, 0);
  const categoryCounts = catalogCategoryItems.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
  const roomById = new Map(allRooms.map((room) => [room._id.toString(), room]));
  const overlapRecords = placementErrors
    .map((record) => ({
      ...record.toObject(),
      roomId: record.roomId,
      roomName: roomById.get(record.roomId.toString())?.roomName || 'Unknown room',
      username: roomById.get(record.roomId.toString())?.userId?.username || 'Unknown user',
    }))
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt));
  const totalArea = allRooms.reduce(
    (total, room) => total + room.dimensions.width * room.dimensions.length,
    0
  );
  const monthlyRooms = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index), 1);
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    const count = allRooms.filter((room) => {
      const created = new Date(room.createdAt);
      return created.getMonth() === date.getMonth() && created.getFullYear() === year;
    }).length;
    return { month, count };
  });

  res.json({
    stats: {
      users: users.length,
      admins: users.filter((user) => user.role === 'admin').length,
      rooms: await Room.countDocuments(),
      catalogItems,
      placements: totalPlacements,
      overlaps: overlapRecords.length,
      averageArea: allRooms.length ? Math.round(totalArea / allRooms.length) : 0,
      categoryCounts,
    },
    users,
    recentRooms,
    monthlyRooms,
    recentOverlaps: overlapRecords.slice(0, 8),
  });
}

module.exports = { register, login, firebaseSync, syncFirebaseUsers, syncFirebaseUsersFromFirebase, createAdmin, createUser, deleteUser, verifyEmail, resendVerification, getAdminOverview };
