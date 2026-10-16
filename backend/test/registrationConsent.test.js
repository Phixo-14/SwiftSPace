const test = require('node:test');
const assert = require('node:assert/strict');
const { publicRegisterSchema, firebaseSyncSchema } = require('../src/middleware/validators');

const registration = {
  username: 'Alex Example',
  email: 'alex@example.com',
  password: 'StrongPassword!123',
};

test('public registration requires explicit terms consent', () => {
  assert.ok(publicRegisterSchema.validate(registration).error);
  assert.ok(publicRegisterSchema.validate({ ...registration, termsAccepted: false }).error);
  assert.equal(
    publicRegisterSchema.validate({ ...registration, termsAccepted: true }).error,
    undefined
  );
});

test('Firebase account creation can carry explicit terms consent', () => {
  const payload = {
    idToken: 'firebase-token',
    username: 'Alex Example',
    termsAccepted: true,
  };
  assert.equal(firebaseSyncSchema.validate(payload).error, undefined);
});

test('Firebase sign-in sync remains valid without a new consent value', () => {
  const payload = {
    idToken: 'firebase-token',
    username: 'Alex Example',
  };
  assert.equal(firebaseSyncSchema.validate(payload).error, undefined);
});
