const mongoose = require('mongoose');

const PlacedItemSchema = new mongoose.Schema(
  {
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem', required: true },
    gridX: { type: Number, required: true, min: 0 },
    gridY: { type: Number, required: true, min: 0 },
    rotation: { type: Number, required: true, enum: [0, 90, 180, 270], default: 0 },
    customColor: { type: String, default: null },
  },
  { _id: false }
);

const OverlapRecordSchema = new mongoose.Schema(
  {
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem', required: true },
    gridX: { type: Number, required: true, min: 0 },
    gridY: { type: Number, required: true, min: 0 },
    rotation: { type: Number, required: true, enum: [0, 90, 180, 270], default: 0 },
    reason: { type: String, required: true, maxlength: 180 },
    occurredAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const RoomSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roomName: { type: String, required: true, trim: true, maxlength: 60 },
    timerSeconds: { type: Number, required: true, min: 0, default: 0 },
    dimensions: {
      width: { type: Number, required: true, min: 1, max: 50 },
      length: { type: Number, required: true, min: 1, max: 50 },
    },
    floorColor: { type: String, default: '#BCA17A' },
    gridColor: { type: String, default: '#8C7455' },
    placedItems: { type: [PlacedItemSchema], default: [] },
    overlapRecords: { type: [OverlapRecordSchema], default: [] },
  },
  { timestamps: true }
);

// Single-field index on userId so a user's dashboard load is an index
// lookup rather than a full collection scan.
RoomSchema.index({ userId: 1 });

module.exports = mongoose.model('Room', RoomSchema);
