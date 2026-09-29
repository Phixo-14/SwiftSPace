const mongoose = require('mongoose');

const FurnitureRotationAdjustmentSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    placementId: { type: String, required: true },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem', required: true },
    fromDegrees: { type: Number, required: true, min: 0, max: 359 },
    toDegrees: { type: Number, required: true, min: 0, max: 359 },
  },
  { timestamps: true }
);

FurnitureRotationAdjustmentSchema.index({ roomId: 1, createdAt: -1 });
FurnitureRotationAdjustmentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('FurnitureRotationAdjustment', FurnitureRotationAdjustmentSchema);