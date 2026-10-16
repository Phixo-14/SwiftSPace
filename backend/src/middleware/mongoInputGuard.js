function containsMongoOperatorKey(value) {
  if (!value || typeof value !== 'object') return false;

  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    for (const [key, child] of Object.entries(current)) {
      if (key.startsWith('$') || key.includes('.')) return true;
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

function rejectMongoOperators(req, res, next) {
  if (containsMongoOperatorKey(req.body) || containsMongoOperatorKey(req.query)) {
    return res.status(400).json({ message: 'MongoDB operator and dotted field keys are not allowed.' });
  }
  next();
}

module.exports = { rejectMongoOperators, containsMongoOperatorKey };
