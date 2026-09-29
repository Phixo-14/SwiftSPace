const mongoose = require('mongoose');

const PlacedItemSchema = new mongoose.Schema(
  {
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem', required: true },
    gridX: { type: Number, required: true, min: 0 },
    gridY: { type: Number, required: true, min: 0 },
    rotation: { type: Number, required: true, min: 0, max: 359, default: 0 },
    customColor: { type: String, default: null },
  },
  { _id: false }
);

const RoomSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roomName: { type: String, required: true, trim: true, maxlength: 60 },
    clientName: { type: String, trim: true, maxlength: 120, default: '' },
    measurements: {
      width: { type: Number, min: 0.01, max: 10000, default: null },
      length: { type: Number, min: 0.01, max: 10000, default: null },
      unit: { type: String, enum: ['mm', 'cm', 'm', 'in', 'ft'], default: 'ft' },
    },
    designNotes: { type: String, maxlength: 5000, default: '' },
    shareToken: { type: String, unique: true, sparse: true },
    dimensions: {
      width: { type: Number, required: true, min: 1, max: 50 },
      length: { type: Number, required: true, min: 1, max: 50 },
    },
    floorColor: { type: String, default: '#BCA17A' },
    gridColor: { type: String, default: '#8C7455' },
    placedItems: { type: [PlacedItemSchema], default: [] },
  },
  { timestamps: true }
);

// Single-field index on userId so a user's dashboard load is an index
// lookup rather than a full collection scan.
RoomSchema.index({ userId: 1 });

module.exports = mongoose.model('Room', RoomSchema);
