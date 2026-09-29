const SystemLog = require('../models/SystemLog');

async function getSystemLogs(req, res) {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
  const filter = {};

  if (req.query.level && req.query.level !== 'all') {
    if (!['info', 'warn', 'error'].includes(req.query.level)) {
      return res.status(400).json({ message: 'Log level must be info, warn, error, or all.' });
    }
    filter.level = req.query.level;
  }

  const logs = await SystemLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ logs, retentionDays: 30 });
}

module.exports = { getSystemLogs };