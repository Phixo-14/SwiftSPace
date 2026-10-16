const test = require('node:test');
const assert = require('node:assert/strict');
const { accountDeleteSchema } = require('../src/middleware/validators');

test('account deletion requires a password', () => {
  assert.equal(accountDeleteSchema.validate({}).error?.details[0].path[0], 'password');
  assert.equal(accountDeleteSchema.validate({ idToken: 'firebase-token' }).error?.details[0].path[0], 'password');
});

test('account deletion accepts a password', () => {
  const { error, value } = accountDeleteSchema.validate({ password: 'CurrentPassword!123' });
  assert.equal(error, undefined);
  assert.deepEqual(value, { password: 'CurrentPassword!123' });
});

test('account deletion rejects an ID token as a substitute for the password', () => {
  assert.ok(accountDeleteSchema.validate({
    password: 'CurrentPassword!123',
    idToken: 'untrusted-token',
  }).error);
});
