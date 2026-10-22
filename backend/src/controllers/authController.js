const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const User = require('../models/User');
const Room = require('../models/Room');
const ProjectFolder = require('../models/ProjectFolder');
const RoomVersion = require('../models/RoomVersion');
const FurnitureRotationAdjustment = require('../models/FurnitureRotationAdjustment');
const CatalogItem = require('../models/CatalogItem');
const RoomTimer = require('../models/RoomTimer');
const PlacementError = require('../models/PlacementError');
const getFirebaseAdmin = require('../config/firebaseAdmin');

const INITIAL_ADMIN_SETUP_ID = 'initial-admin-setup';

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

function sanitizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function getInitialAdminSetup() {
  return User.db.collection('systemsettings').findOne({ _id: INITIAL_ADMIN_SETUP_ID });
}

async function registrationIsOpen() {
  const setup = await getInitialAdminSetup();
  if (setup?.status === 'complete') return true;

  // Older installations may already have an admin account without the
  // one-time setup marker. Treat that account as completed setup so public
  // registration does not remain locked indefinitely.
  return Boolean(await User.exists({ role: 'admin' }));
}

function hasValidInitialAdminToken(token) {
  const expected = process.env.INITIAL_ADMIN_SETUP_TOKEN || '';
  const provided = String(token || '');
  if (expected.length < 32 || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

async function getFirebaseIdentity(idToken) {
  const firebase = getFirebaseAdmin();
  if (firebase) return firebase.auth().verifyIdToken(idToken);
  if (!process.env.FIREBASE_WEB_API_KEY) throw new Error('Firebase server configuration is missing.');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(process.env.FIREBASE_WEB_API_KEY)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
  );
  const result = await response.json();
  const account = result.users?.[0];
  if (!response.ok || !account) throw new Error('Invalid Firebase authentication token.');
  return { uid: account.localId, email: account.email, email_verified: account.emailVerified };
}

async function registrationStatus(req, res) {
  const complete = await registrationIsOpen();
  res.json({
    registrationOpen: complete,
    adminSetupAvailable: !complete && Boolean(process.env.INITIAL_ADMIN_SETUP_TOKEN),
  });
}

// POST /api/auth/firebase-registration-intent
// Persist profile details and consent immediately after Firebase signup so
// verification links can be opened in another browser without losing consent.
async function saveFirebaseRegistrationIntent(req, res) {
  if (!(await registrationIsOpen())) {
    return res.status(403).json({ message: 'The client administrator must complete the one-time setup before registration opens.' });
  }

  let identity;
  try {
    identity = await getFirebaseIdentity(req.body.idToken);
  } catch {
    return res.status(401).json({ message: 'Invalid Firebase authentication token.' });
  }
  if (!identity.uid || !identity.email) {
    return res.status(400).json({ message: 'The Firebase account must include an email address.' });
  }

  const cleanEmail = sanitizeEmail(identity.email);
  const cleanUsername = normalizeUsername(req.body.username);
  let user = await User.findOne({ $or: [{ firebaseUid: identity.uid }, { email: cleanEmail }] });
  if (user?.role === 'admin') {
    return res.status(409).json({ message: 'This account is already registered as an administrator.' });
  }
  if (user?.firebaseUid && user.firebaseUid !== identity.uid) {
    return res.status(409).json({ message: 'This email is linked to a different Firebase account.' });
  }

  if (!user) {
    user = new User({
      username: cleanUsername,
      email: cleanEmail,
      firebaseUid: identity.uid,
      passwordHash: crypto.randomBytes(32).toString('hex'),
      role: req.body.role,
      emailVerified: Boolean(identity.email_verified),
      termsAcceptedAt: new Date(),
    });
  } else {
    user.firebaseUid = identity.uid;
    if (!user.emailVerified) {
      user.username = cleanUsername;
      user.role = req.body.role;
    }
    user.emailVerified = user.emailVerified || Boolean(identity.email_verified);
    user.termsAcceptedAt = user.termsAcceptedAt || new Date();
  }

  await user.save();
  return res.json({ message: 'Registration details saved. Verify your email to continue.' });
}

async function validateInitialAdminSetup(req, res) {
  if (!hasValidInitialAdminToken(req.body.setupToken)) {
    return res.status(403).json({ message: 'This administrator setup link is invalid or has already been used.' });
  }

  const setup = await getInitialAdminSetup();
  if (setup?.status === 'complete' || setup?.status === 'setting-up') {
    return res.status(409).json({ message: 'The one-time administrator setup has already been claimed.' });
  }
  res.json({ available: true });
}

async function setupInitialAdmin(req, res) {
  if (!hasValidInitialAdminToken(req.body.setupToken)) {
    return res.status(403).json({ message: 'This administrator setup link is invalid or has already been used.' });
  }

  const { username, email, password, idToken, termsAccepted } = req.body;
  if (termsAccepted !== true) {
    return res.status(400).json({ message: 'You must accept the Terms of Service and Privacy Policy to create an account.' });
  }

  let identity;
  if (idToken) {
    try {
      identity = await getFirebaseIdentity(idToken);
    } catch {
      return res.status(401).json({ message: 'Invalid Firebase authentication token.' });
    }
    if (sanitizeEmail(email) !== sanitizeEmail(identity.email)) {
      return res.status(400).json({ message: 'The verified Firebase account email does not match the submitted email.' });
    }
  } else if (!strongPassword(password)) {
    return res.status(400).json({ message: 'Password must be 8–16 characters and include upper/lowercase letters, a number, and a symbol.' });
  }

  const cleanEmail = sanitizeEmail(identity?.email || email);
  const cleanUsername = normalizeUsername(username);
  if (!cleanEmail || !cleanUsername) return res.status(400).json({ message: 'Name and email are required.' });

  const settings = User.db.collection('systemsettings');
  const existingSetup = await settings.findOne({ _id: INITIAL_ADMIN_SETUP_ID });
  if (existingSetup?.status === 'complete') {
    return res.status(409).json({ message: 'The one-time administrator setup has already been completed.' });
  }

  const existingUser = await User.findOne({ email: cleanEmail });
  if (existingUser) {
    if (existingUser.role === 'admin' && (!identity || existingUser.firebaseUid === identity.uid)) {
      await settings.updateOne(
        { _id: INITIAL_ADMIN_SETUP_ID },
        { $set: { status: 'complete', email: cleanEmail, uid: identity?.uid || null, completedAt: new Date() } },
        { upsert: true }
      );
      return res.json({ message: 'Administrator setup is complete.', email: cleanEmail });
    }
    return res.status(409).json({ message: 'An account already uses this email. Enter a different client email.' });
  }

  const claim = await settings.updateOne(
    { _id: INITIAL_ADMIN_SETUP_ID },
    { $setOnInsert: { status: 'setting-up', email: cleanEmail, uid: identity?.uid || null, startedAt: new Date() } },
    { upsert: true }
  );
  const setupState = claim.upsertedCount === 1
    ? null
    : await settings.findOne({ _id: INITIAL_ADMIN_SETUP_ID });
  if (setupState) {
    return res.status(409).json({ message: 'The one-time administrator setup has already been claimed.' });
  }

  let user;
  try {
    const code = identity ? null : createVerificationCode();
    user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      firebaseUid: identity?.uid || null,
      passwordHash: identity ? crypto.randomBytes(32).toString('hex') : await bcrypt.hash(password, 10),
      role: 'admin',
      emailVerified: Boolean(identity?.email_verified),
      termsAcceptedAt: new Date(),
      emailVerificationCodeHash: code ? hashVerificationCode(code) : null,
      emailVerificationExpiresAt: code ? new Date(Date.now() + 10 * 60 * 1000) : null,
      passwordChangedAt: new Date(),
    });

    await settings.updateOne(
      { _id: INITIAL_ADMIN_SETUP_ID, email: cleanEmail },
      { $set: { status: 'complete', completedAt: new Date() } }
    );

    if (!identity) {
      const delivered = await sendVerificationCode(user, code);
      return res.status(201).json({
        message: delivered ? 'Verification code sent.' : 'Email could not be delivered. Check the backend terminal for the verification code.',
        email: user.email,
        ...(process.env.NODE_ENV !== 'production' ? { developmentCode: code } : {}),
      });
    }
    return res.status(201).json({ message: 'Admin account created. Verify your email to sign in.', email: user.email });
  } catch (error) {
    if (user) {
      await settings.updateOne(
        { _id: INITIAL_ADMIN_SETUP_ID, email: cleanEmail },
        { $set: { status: 'complete', completedAt: new Date() } }
      );
    } else {
      await settings.deleteOne({ _id: INITIAL_ADMIN_SETUP_ID, status: 'setting-up', email: cleanEmail });
    }
    throw error;
  }
}

function strongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}$/.test(password || '');
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function getTotpSecret() {
  return crypto.randomBytes(20).toString('hex');
}

function generateTotp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const bytes = Buffer.alloc(8);
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const digest = crypto.createHmac('sha1', Buffer.from(secret, 'hex')).update(bytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function verifyTotp(secret, code) {
  if (!secret || !code) return false;
  const normalized = String(code).replace(/\s+/g, '');
  const now = Date.now();
  return normalized === generateTotp(secret, now)
    || normalized === generateTotp(secret, now - 30000)
    || normalized === generateTotp(secret, now + 30000);
}

async function sendVerificationCode(user, code) {
  const message = {
    from: process.env.RESEND_FROM || process.env.SMTP_FROM,
    to: user.email,
    subject: 'Verify your SwiftSpace email',
    text: `Your SwiftSpace verification code is ${code}. It expires in 10 minutes.`,
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
    { id: user._id.toString(), username: user.username, role: user.role || 'homeowner' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function issueUserSession(user, req, res) {
  if (user.bannedAt) {
    return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });
  }
  const token = signToken(user);
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.lastLoginIp = getRequestIp(req);
  await user.save();
  res.json({
    token,
    user: { id: user._id, username: user.username, email: user.email, role: user.role || 'homeowner' },
  });
}

// POST /api/auth/register
async function register(req, res) {
  if (!(await registrationIsOpen())) {
    return res.status(403).json({ message: 'The client administrator must complete the one-time setup before registration opens.' });
  }
  const { username, email, password, role } = req.body;
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = sanitizeEmail(email);

  if (!strongPassword(password)) {
    return res.status(400).json({ message: 'Password must be 8–16 characters and include upper/lowercase letters, a number, and a symbol.' });
  }

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    if (existing.bannedAt) {
      return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });
    }
    if (existing.role === 'admin' || existing.emailVerified) {
      return res.status(409).json({ message: 'A user with that email already exists.' });
    }
    await existing.deleteOne();
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const code = createVerificationCode();
  const user = await User.create({
    username: cleanUsername,
    email: cleanEmail,
    passwordHash,
    role,
    emailVerified: false,
    termsAcceptedAt: new Date(),
    emailVerificationCodeHash: hashVerificationCode(code),
    emailVerificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    passwordChangedAt: new Date(),
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

async function verifyMfaLogin(req, res) {
  const { email, password, code } = req.body;
  const cleanEmail = sanitizeEmail(email);
  try {
    if (!(await registrationIsOpen())) {
      return res.status(403).json({ message: 'Administrator setup has not been completed yet.' });
    }
    const user = await User.findOne({ email: cleanEmail });
    if (!user || !user.mfaEnabled) {
      return res.status(401).json({ message: 'Invalid email or MFA code.' });
    }
    if (user.bannedAt) return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ message: 'This account is temporarily locked because of repeated failed logins.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (!verifyTotp(user.mfaSecret, code)) {
      return res.status(401).json({ message: 'Invalid MFA code.' });
    }

    await issueUserSession(user, req, res);
  } catch (error) {
    console.error(`MFA login failed for ${cleanEmail}:`, error);
    res.status(500).json({ message: 'MFA login service error. Check the backend logs.' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;
  const cleanEmail = sanitizeEmail(email);
  try {
    if (!(await registrationIsOpen())) {
      return res.status(403).json({ message: 'Administrator setup has not been completed yet.' });
    }
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    if (user.bannedAt) return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ message: 'This account is temporarily locked because of repeated failed logins.' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ message: 'Please verify your email before signing in.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save();
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (user.mfaEnabled) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await user.save();
      return res.status(202).json({
        message: 'Multi-factor authentication required.',
        requiresMfa: true,
        email: user.email,
      });
    }

    await issueUserSession(user, req, res);
  } catch (error) {
    console.error(`Login failed for ${cleanEmail}:`, error);
    res.status(500).json({ message: 'Login service error. Check the backend logs.' });
  }
}

async function adminLogin(req, res) {
  const { email, password } = req.body;
  const cleanEmail = sanitizeEmail(email);
  try {
    if (!(await registrationIsOpen())) {
      return res.status(403).json({ message: 'Administrator setup has not been completed yet.' });
    }
    const user = await User.findOne({ email: cleanEmail, role: 'admin' });
    if (!user) {
      return res.status(401).json({ message: 'Invalid administrator email or password.' });
    }
    if (user.bannedAt) return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ message: 'This account is temporarily locked because of repeated failed logins.' });
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save();
      return res.status(401).json({ message: 'Invalid administrator email or password.' });
    }

    await issueUserSession(user, req, res);
  } catch (error) {
    console.error(`Admin login failed for ${cleanEmail}:`, error);
    res.status(500).json({ message: 'Admin login service error. Check the backend logs.' });
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
  if (!(await registrationIsOpen())) {
    return res.status(403).json({ message: 'The client administrator must complete the one-time setup before registration opens.' });
  }

  try {
    let user = await User.findOne({ $or: [{ firebaseUid: decoded.uid }, { email: decoded.email }] });
    if (user?.bannedAt) {
      return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });
    }
    if (!user) {
      if (req.body.termsAccepted !== true) {
        return res.status(400).json({ message: 'You must accept the Terms of Service and Privacy Policy to create an account.' });
      }

      try {
        user = await User.create({
          username: req.body.username.trim().replace(/\s+/g, ' '),
          email: decoded.email,
          firebaseUid: decoded.uid,
          passwordHash: crypto.randomBytes(32).toString('hex'),
          emailVerified: true,
          role: req.body.role || 'homeowner',
          termsAcceptedAt: new Date(),
        });
      } catch (createError) {
        if (createError.code !== 11000 || (!createError.keyPattern?.email && !createError.keyPattern?.firebaseUid)) {
          throw createError;
        }
        user = await User.findOne({ $or: [{ firebaseUid: decoded.uid }, { email: decoded.email }] });
        if (!user) throw createError;
        if (user.bannedAt) return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });
        user.firebaseUid = decoded.uid;
        user.emailVerified = true;
        if (req.body.termsAccepted === true && !user.termsAcceptedAt) {
          user.termsAcceptedAt = new Date();
        }
        await user.save();
      }
    } else {
      user.firebaseUid = decoded.uid;
      user.emailVerified = true;
      if (req.body.termsAccepted === true && !user.termsAcceptedAt) {
        user.termsAcceptedAt = new Date();
      }
      await user.save();
    }

    if (user.bannedAt) return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });
    const token = signToken(user);
    return res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    console.error(`Firebase account sync failed for ${decoded.email}:`, error);
    return res.status(500).json({ message: 'Could not complete account setup. Please try again.' });
  }
}

async function startMfaSetup(req, res) {
  const user = await User.findById(req.user.id).select('_id username email mfaEnabled mfaSecret');
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.mfaEnabled) {
    return res.status(409).json({ message: 'Multi-factor authentication is already enabled.' });
  }

  const secret = getTotpSecret();
  user.mfaSecret = secret;
  await user.save();

  const otpAuth = `otpauth://totp/SwiftSpace:${encodeURIComponent(user.email)}?secret=${secret}&issuer=SwiftSpace`;
  res.json({
    secret,
    otpauth: otpAuth,
    message: 'Scan this code in an authenticator app, then verify it with a 6-digit code.',
  });
}

async function verifyMfaSetup(req, res) {
  const { code } = req.body;
  const user = await User.findById(req.user.id).select('_id username email mfaSecret mfaEnabled');
  if (!user || !user.mfaSecret) {
    return res.status(400).json({ message: 'MFA setup has not started.' });
  }

  if (!verifyTotp(user.mfaSecret, code)) {
    return res.status(401).json({ message: 'Invalid MFA verification code.' });
  }

  user.mfaEnabled = true;
  user.passwordChangedAt = new Date();
  await user.save();
  res.json({ message: 'Multi-factor authentication enabled successfully.' });
}

async function disableMfa(req, res) {
  const { code } = req.body;
  const user = await User.findById(req.user.id).select('_id username email mfaSecret mfaEnabled');
  if (!user || !user.mfaEnabled) {
    return res.status(400).json({ message: 'MFA is not enabled for this account.' });
  }

  if (!verifyTotp(user.mfaSecret, code)) {
    return res.status(401).json({ message: 'Invalid MFA verification code.' });
  }

  user.mfaEnabled = false;
  user.mfaSecret = null;
  user.passwordChangedAt = new Date();
  await user.save();
  res.json({ message: 'Multi-factor authentication disabled.' });
}

async function deleteUserData(userIds) {
  await Promise.all([
    Room.deleteMany({ userId: { $in: userIds } }),
    RoomVersion.deleteMany({ userId: { $in: userIds } }),
    FurnitureRotationAdjustment.deleteMany({ userId: { $in: userIds } }),
    RoomTimer.deleteMany({ userId: { $in: userIds } }),
    PlacementError.deleteMany({ userId: { $in: userIds } }),
    ProjectFolder.deleteMany({ userId: { $in: userIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function deleteFirebaseUser(req, res) {
  const configuredSecret = process.env.AUTH_DELETE_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return res.status(503).json({ message: 'Firebase deletion webhook is not configured.' });
  }

  const expected = Buffer.from(configuredSecret);
  const received = Buffer.from(req.get('x-firebase-delete-secret') || '');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ message: 'Invalid Firebase deletion webhook secret.' });
  }

  const user = await User.findOne({ firebaseUid: req.body.uid, role: { $ne: 'admin' } }).select('_id');
  if (user) await deleteUserData([user._id]);
  res.status(204).send();
}

async function deleteAccount(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'Account not found.' });
  if (user.role === 'admin') {
    return res.status(403).json({ message: 'Admin accounts cannot be deleted here.' });
  }

  const { password } = req.body;
  if (user.firebaseUid) {
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: 'Password verification for this account is not configured.' });
    }

    let signInResponse;
    try {
      signInResponse = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
        }
      );
    } catch (error) {
      console.error(`Firebase password verification failed for account ${user._id}:`, error.message);
      return res.status(502).json({ message: 'Could not verify your password with Firebase. Please try again.' });
    }

    const signInResult = await signInResponse.json();
    if (!signInResponse.ok || signInResult.localId !== user.firebaseUid) {
      const firebaseError = signInResult.error?.message;
      if (['INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED'].includes(firebaseError)
        || (signInResponse.ok && signInResult.localId !== user.firebaseUid)) {
        return res.status(401).json({ message: 'Your password is incorrect.' });
      }
      console.error(`Firebase password verification failed for account ${user._id}:`, firebaseError || signInResponse.status);
      return res.status(502).json({ message: 'Could not verify your password with Firebase. Please try again.' });
    }

    const firebase = getFirebaseAdmin();
    if (firebase) {
      try {
        await firebase.auth().deleteUser(user.firebaseUid);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
      }
    } else {
      let deleteResponse;
      try {
        deleteResponse = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: signInResult.idToken }),
          }
        );
      } catch (error) {
        console.error(`Firebase account deletion failed for account ${user._id}:`, error.message);
        return res.status(502).json({ message: 'Firebase could not delete this account. Please try again.' });
      }
      if (!deleteResponse.ok) {
        const deleteResult = await deleteResponse.json();
        console.error(`Firebase account deletion failed for account ${user._id}:`, deleteResult.error?.message || deleteResponse.status);
        return res.status(502).json({ message: 'Firebase could not delete this account. Please try again.' });
      }
    }
  } else if (!(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Your password is incorrect.' });
  }

  await deleteUserData([user._id]);
  res.status(204).send();
}

async function syncFirebaseUsersFromFirebase() {
  const firebase = getFirebaseAdmin();
  if (!firebase) {
    throw new Error('Firebase Admin credentials are not configured.');
  }

  let page;
  let synced = 0;
  let skipped = 0;
  const firebaseUids = new Set();
  do {
    page = await firebase.auth().listUsers(1000, page?.pageToken);
    for (const firebaseUser of page.users) {
      firebaseUids.add(firebaseUser.uid);
      if (!firebaseUser.email) {
        skipped += 1;
        continue;
      }

      let user = await User.findOne({
        $or: [{ firebaseUid: firebaseUser.uid }, { email: firebaseUser.email.toLowerCase() }],
      });
      if (!user) {
        const username = (firebaseUser.displayName || firebaseUser.email.split('@')[0])
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 24) || 'user';
        user = new User({
          username,
          email: firebaseUser.email,
          firebaseUid: firebaseUser.uid,
          passwordHash: crypto.randomBytes(32).toString('hex'),
          role: 'homeowner',
        });
      }

      user.firebaseUid = firebaseUser.uid;
      user.email = firebaseUser.email;
      user.emailVerified = firebaseUser.emailVerified;
      await user.save();
      synced += 1;
    }
  } while (page.pageToken);

  const staleFirebaseUsers = await User.find({
    firebaseUid: { $type: 'string', $nin: [...firebaseUids] },
    role: { $ne: 'admin' },
  }).select('_id');
  const staleUserIds = staleFirebaseUsers.map((user) => user._id);
  if (staleUserIds.length) await deleteUserData(staleUserIds);

  return { synced, skipped, deleted: staleUserIds.length };
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
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = sanitizeEmail(email);

  if (!strongPassword(password)) {
    return res.status(400).json({ message: 'Password must be 8–16 characters and include upper/lowercase letters, a number, and a symbol.' });
  }

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    return res.status(409).json({ message: 'A user with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username: cleanUsername, email: cleanEmail, passwordHash, role: 'admin', passwordChangedAt: new Date() });

  res.status(201).json({
    user: { id: user._id, username: user.username, email: user.email, role: user.role },
  });
}

// POST /api/auth/verify-email
async function verifyEmail(req, res) {
  const { email, code } = req.body;
  const cleanEmail = sanitizeEmail(email);
  const user = await User.findOne({ email: cleanEmail, emailVerified: false });
  if (!user) {
    return res.status(400).json({ message: 'Invalid or expired verification code.' });
  }
  if (user.bannedAt) return res.status(403).json({ message: 'This account has been banned. Contact an administrator.' });
  const currentHash = user.emailVerificationCodeHash ? Buffer.from(user.emailVerificationCodeHash, 'hex') : null;
  const candidateHash = Buffer.from(hashVerificationCode(code), 'hex');
  if (user.emailVerificationExpiresAt < new Date() || !currentHash || currentHash.length !== candidateHash.length || !crypto.timingSafeEqual(currentHash, candidateHash)) {
    return res.status(400).json({ message: 'Invalid or expired verification code.' });
  }

  user.emailVerified = true;
  user.emailVerificationCodeHash = null;
  user.emailVerificationExpiresAt = null;
  user.passwordChangedAt = new Date();
  await user.save();
  const token = signToken(user);
  res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
}

// POST /api/auth/resend-verification
async function resendVerification(req, res) {
  const cleanEmail = sanitizeEmail(req.body.email);
  const user = await User.findOne({ email: cleanEmail, emailVerified: false });
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

// PATCH /api/auth/users/:id/ban — requires an existing admin token.
// POST /api/auth/firebase/resend-verification-link
// Generate a Firebase action link and send it through the app's configured
// email provider when Firebase's client-side email delivery is throttled.
async function resendFirebaseVerificationLink(req, res) {
  const firebase = getFirebaseAdmin();
  if (!firebase) {
    return res.status(503).json({ message: 'Verification email fallback is not configured. Add the Firebase Admin service account to the backend environment.' });
  }

  let identity;
  try {
    identity = await firebase.auth().verifyIdToken(req.body.idToken);
  } catch {
    return res.status(401).json({ message: 'Your sign-in session expired. Sign in again and retry.' });
  }
  if (!identity.email) return res.status(400).json({ message: 'The signed-in Firebase account has no email address.' });
  if (identity.email_verified) return res.json({ message: 'This email is already verified.' });

  const resendConfigured = process.env.RESEND_API_KEY
    && !process.env.RESEND_API_KEY.startsWith('replace-with-');
  if (!resendConfigured && !mailTransport) {
    return res.status(503).json({ message: 'Email delivery is not configured on the backend. Set up Resend or SMTP, then retry.' });
  }

  try {
    const continueUrl = new URL('/verify-email', process.env.CLIENT_ORIGIN || 'https://swiftspace-web.onrender.com');
    continueUrl.searchParams.set('email', identity.email);
    // Firebase's hosted action handler consumes the code before redirecting to
    // the continue URL, so the app needs a marker to render the success state.
    continueUrl.searchParams.set('verification', 'success');
    let verificationLink;
    try {
      verificationLink = await firebase.auth().generateEmailVerificationLink(identity.email, {
        url: continueUrl.toString(),
        handleCodeInApp: true,
      });
    } catch {
      verificationLink = await firebase.auth().generateEmailVerificationLink(identity.email);
    }

    const emailMessage = {
      from: process.env.RESEND_FROM || process.env.SMTP_FROM,
      to: identity.email,
      subject: 'Verify your SwiftSpace email',
      text: `Use this link to verify your SwiftSpace email address:\n\n${verificationLink}\n\nIf you did not create this account, you can ignore this message.`,
    };
    if (resendConfigured) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emailMessage),
      });
      if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
    } else {
      await mailTransport.sendMail(emailMessage);
    }
    return res.json({ message: 'A verification link was sent through SwiftSpace email delivery.' });
  } catch (error) {
    console.error(`Could not deliver Firebase verification link: ${error.message}`);
    return res.status(502).json({ message: 'SwiftSpace could not send the verification email. Check the backend email provider settings.' });
  }
}

async function banUser(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: 'You cannot ban your own admin account.' });
  }

  const { banned } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found or cannot be changed.' });

  user.bannedAt = banned ? (user.bannedAt || new Date()) : null;
  user.bannedBy = banned ? req.user.id : null;
  user.passwordChangedAt = new Date();
  await user.save();
  res.json({ user: {
    _id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    bannedAt: user.bannedAt,
  } });
}

// GET /api/auth/admin/overview — requires an existing admin token.
async function getAdminOverview(req, res) {
  const [users, rooms, catalogItems, catalogCategoryItems, allRooms, timers, placementErrors, rotationAdjustments, rearrangementRecordCount, rearrangementVersions] = await Promise.all([
    User.find().select('_id username email role bannedAt createdAt').sort({ role: 1, createdAt: -1 }),
    Room.find().select('roomName dimensions userId createdAt updatedAt').populate('userId', 'username email').sort({ updatedAt: -1 }),
    CatalogItem.countDocuments(),
    CatalogItem.find().select('category'),
    Room.find()
      .select('roomName dimensions placedItems createdAt userId')
      .populate('userId', 'username'),
    RoomTimer.find(),
    PlacementError.find()
      .populate('catalogItemId', 'name')
      .populate('userId', 'username email'),
    FurnitureRotationAdjustment.countDocuments(),
    RoomVersion.countDocuments({ name: /^Rearrangement record ·/ }),
    RoomVersion.find({ name: /^Rearrangement record ·/ })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('roomId', 'roomName')
      .populate('userId', 'username'),
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
    .filter((record) => /overlap/i.test(record.reason || ''))
    .map((record) => ({
      ...record.toObject(),
      roomId: record.roomId,
      roomName: roomById.get(record.roomId.toString())?.roomName || 'Unknown room',
      username: record.userId?.username || roomById.get(record.roomId.toString())?.userId?.username || 'Unknown user',
      userEmail: record.userId?.email || roomById.get(record.roomId.toString())?.userId?.email || '',
    }))
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt));
  const recentRearrangements = rearrangementVersions.map((record) => ({
    _id: record._id,
    name: record.name,
    createdAt: record.createdAt,
    timerSeconds: record.snapshot?.timerSeconds || 0,
    roomId: record.roomId?._id || null,
    roomName: record.roomId?.roomName || 'Deleted room',
    username: record.userId?.username || 'Deleted user',
  }));
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
      furnitureRotationAdjustments: rotationAdjustments,
      rearrangementRecords: rearrangementRecordCount,
      overlaps: overlapRecords.length,
      averageArea: allRooms.length ? Math.round(totalArea / allRooms.length) : 0,
      categoryCounts,
    },
    users,
    recentRooms,
    recentRearrangements,
    monthlyRooms,
    recentOverlaps: overlapRecords,
  });
}

module.exports = {
  registrationStatus,
  saveFirebaseRegistrationIntent,
  validateInitialAdminSetup,
  setupInitialAdmin,
  register,
  login,
  adminLogin,
  firebaseSync,
  resendFirebaseVerificationLink,
  deleteFirebaseUser,
  deleteAccount,
  syncFirebaseUsers,
  syncFirebaseUsersFromFirebase,
  createAdmin,
  banUser,
  verifyEmail,
  resendVerification,
  getAdminOverview,
  startMfaSetup,
  verifyMfaSetup,
  disableMfa,
  verifyMfaLogin,
};
