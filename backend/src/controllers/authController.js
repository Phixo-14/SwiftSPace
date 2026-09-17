const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
async function register(req, res) {
  const { username, email, password } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    return res.status(409).json({ message: 'A user with that email or username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username, email, passwordHash });

  const token = signToken(user);
  res.status(201).json({
    token,
    user: { id: user._id, username: user.username, email: user.email },
  });
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user._id, username: user.username, email: user.email },
  });
}

module.exports = { register, login };
