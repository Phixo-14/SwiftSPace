const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies the Authorization: Bearer <token> header and attaches the
// decoded { id, username } payload to req.user for downstream ownership checks.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select('_id username email role');
    if (!user) return res.status(401).json({ message: 'Invalid or expired token.' });
    req.user = { id: user._id.toString(), username: user.username, email: user.email, role: user.role || 'user' };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
