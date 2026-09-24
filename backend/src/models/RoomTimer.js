const mongoose = require('mongoose');

const RoomTimerSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seconds: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

RoomTimerSchema.index({ userId: 1 });

module.exports = mongoose.model('RoomTimer', RoomTimerSchema);