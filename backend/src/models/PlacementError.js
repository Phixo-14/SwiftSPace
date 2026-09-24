const mongoose = require('mongoose');

const PlacementErrorSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem', required: true },
    gridX: { type: Number, required: true, min: 0 },
    gridY: { type: Number, required: true, min: 0 },
    rotation: { type: Number, required: true, enum: [0, 90, 180, 270], default: 0 },
    reason: { type: String, required: true, maxlength: 180 },
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

PlacementErrorSchema.index({ roomId: 1, occurredAt: -1 });
PlacementErrorSchema.index({ userId: 1, occurredAt: -1 });

module.exports = mongoose.model('PlacementError', PlacementErrorSchema);