const mongoose = require('mongoose');

const RoomVersionSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

RoomVersionSchema.index({ roomId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('RoomVersion', RoomVersionSchema);