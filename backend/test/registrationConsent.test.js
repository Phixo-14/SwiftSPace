const test = require('node:test');
const assert = require('node:assert/strict');
const { publicRegisterSchema, firebaseSyncSchema } = require('../src/middleware/validators');

const registration = {
  username: 'Alex Example',
  email: 'alex@example.com',
  password: 'StrongPass!1',
};

test('public registration requires explicit terms consent', () => {
  assert.ok(publicRegisterSchema.validate(registration).error);
  assert.ok(publicRegisterSchema.validate({ ...registration, termsAccepted: false }).error);
  assert.equal(
    publicRegisterSchema.validate({ ...registration, termsAccepted: true }).error,
    undefined
  );
});

test('registration names accept letters only and are limited to 50 characters', () => {
  assert.equal(publicRegisterSchema.validate({
    ...registration,
    username: `${'A'.repeat(25)} ${'B'.repeat(24)}`,
    termsAccepted: true,
  }).error, undefined);
  assert.ok(publicRegisterSchema.validate({
    ...registration,
    username: `${'A'.repeat(25)} ${'B'.repeat(25)}`,
    termsAccepted: true,
  }).error);
  assert.ok(publicRegisterSchema.validate({
    ...registration,
    username: 'Alex 2Example',
    termsAccepted: true,
  }).error);
});

test('registration passwords must be 8 to 16 characters', () => {
  const validatePassword = (password) => publicRegisterSchema.validate({
    ...registration,
    password,
    termsAccepted: true,
  }).error;

  assert.equal(validatePassword('Abcdef1!'), undefined);
  assert.equal(validatePassword('Abcdefghijk1!XYZ'), undefined);
  assert.ok(validatePassword('Abcde1!'));
  assert.ok(validatePassword('Abcdefghijk1!XYZQ'));
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
