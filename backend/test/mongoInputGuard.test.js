const test = require('node:test');
const assert = require('node:assert/strict');
const { containsMongoOperatorKey, rejectMongoOperators } = require('../src/middleware/mongoInputGuard');

test('detects MongoDB operators in nested request objects', () => {
  assert.equal(containsMongoOperatorKey({ user: { email: { $ne: null } } }), true);
  assert.equal(containsMongoOperatorKey({ 'profile.name': 'SwiftSpace' }), true);
});

test('allows regular data, including operator characters in string values', () => {
  assert.equal(containsMongoOperatorKey({ note: 'price is $5.00', profile: { name: 'Alex' } }), false);
  assert.equal(containsMongoOperatorKey(['normal', { role: 'homeowner' }]), false);
});

test('handles deeply nested request objects without recursive traversal', () => {
  const nested = {};
  let current = nested;
  for (let depth = 0; depth < 10000; depth += 1) {
    current.child = {};
    current = current.child;
  }
  current.value = 'safe';

  assert.equal(containsMongoOperatorKey(nested), false);
});

test('rejects operator keys in request bodies and query parameters', () => {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let nextCalled = false;

  rejectMongoOperators(
    { body: {}, query: { filter: { $where: 'true' } } },
    response,
    () => { nextCalled = true; }
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /MongoDB operator/);
  assert.equal(nextCalled, false);
});
