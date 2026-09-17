const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
