const SystemLog = require('../models/SystemLog');

function writeSystemLog(entry) {
  return SystemLog.create(entry).catch((error) => {
    console.error(`Could not store system log: ${error.message}`);
  });
}

function sanitizePath(path) {
  return path
    .split('/')
    .map((segment) => {
      if (/^[a-f\d]{24}$/i.test(segment)) return ':id';
      if (/^[a-f\d]{64}$/i.test(segment)) return ':token';
      return segment;
    })
    .join('/');
}

function systemLoggingMiddleware(req, res, next) {
  const path = req.path;
  if (path === '/health' || path === '/auth/admin/logs') return next();

  const route = sanitizePath(`${req.baseUrl}${path}`).slice(0, 160);
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    void writeSystemLog({
      level,
      source: 'request',
      method: req.method,
      route,
      statusCode,
      durationMs: Math.round(durationMs),
      message: `${req.method} ${route} returned ${statusCode}`,
    });
  });
  next();
}

module.exports = { systemLoggingMiddleware, writeSystemLog };