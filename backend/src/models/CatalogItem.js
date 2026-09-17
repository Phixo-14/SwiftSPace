const mongoose = require('mongoose');

// Catalog items are intentionally loose/schema-flexible: some items (lamps)
// carry a brightness property, others (plants) carry none. `properties` is a
// free-form Mixed bag so new asset types never require a migration.
const CatalogItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: ['seating', 'sleeping', 'storage', 'lighting', 'greenery', 'surface'],
    },
    footprint: {
      width: { type: Number, required: true, min: 1 },
      length: { type: Number, required: true, min: 1 },
    },
    iconKey: { type: String, required: true },
    defaultColor: { type: String, default: '#D9D4C7' },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CatalogItem', CatalogItemSchema);
