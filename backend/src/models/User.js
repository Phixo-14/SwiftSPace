const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    firebaseUid: { type: String, unique: true, sparse: true, default: null },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['homeowner', 'interior-designer', 'admin'], default: 'homeowner' },
    emailVerified: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date, default: null },
    emailVerificationCodeHash: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: Date.now },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: null, select: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
