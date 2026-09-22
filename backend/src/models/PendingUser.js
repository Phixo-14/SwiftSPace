const mongoose = require('mongoose');

const PendingUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    verificationCodeHash: { type: String, required: true },
    verificationExpiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PendingUser', PendingUserSchema);