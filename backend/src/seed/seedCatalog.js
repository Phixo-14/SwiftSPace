// Run with: npm run seed
// Adds starter furniture while preserving existing catalog items.
require('dotenv').config();
const connectDB = require('../config/db');
const CatalogItem = require('../models/CatalogItem');

const ITEMS = [
  { name: 'Platform Bed', category: 'sleeping', footprint: { width: 2, length: 3 }, iconKey: 'bed', defaultColor: '#E7E2D6', properties: {} },
  { name: 'Lounge Chair', category: 'seating', footprint: { width: 1, length: 1 }, iconKey: 'chair', defaultColor: '#C9C2B4', properties: {} },
  { name: 'Writing Desk', category: 'surface', footprint: { width: 2, length: 1 }, iconKey: 'desk', defaultColor: '#B8AE9C', properties: {} },
  { name: 'Open Shelf Rack', category: 'storage', footprint: { width: 1, length: 2 }, iconKey: 'rack', defaultColor: '#A79B85', properties: { shelves: 4 } },
  { name: 'Floor Lamp', category: 'lighting', footprint: { width: 1, length: 1 }, iconKey: 'lamp', defaultColor: '#F2E9D0', properties: { brightness: 70, warmth: 'warm' } },
  { name: 'Potted Fig', category: 'greenery', footprint: { width: 1, length: 1 }, iconKey: 'plant', defaultColor: '#7C8B6E', properties: {} },
  { name: 'Low Bookcase', category: 'storage', footprint: { width: 2, length: 1 }, iconKey: 'rack', defaultColor: '#9C8F76', properties: { shelves: 2 } },
  { name: 'Pendant Light', category: 'lighting', footprint: { width: 1, length: 1 }, iconKey: 'lamp', defaultColor: '#EFE6CB', properties: { brightness: 45, warmth: 'neutral' } },
  { name: 'L Shape Chair', category: 'seating', footprint: { width: 1, length: 1 }, iconKey: 'l-shape-chair', defaultColor: '#FFFFFF', properties: {} },
  { name: 'Square Table 4 Seats', category: 'surface', footprint: { width: 2, length: 2 }, iconKey: 'square-table-4-seats', defaultColor: '#FFFFFF', properties: { seats: 4 } },
  { name: 'Rectangle Table with 4 Chairs', category: 'surface', footprint: { width: 2, length: 3 }, iconKey: 'rectangle-table-4-chairs', defaultColor: '#FFFFFF', properties: { seats: 4 } },
  { name: 'Circle Table with 4 Chairs', category: 'surface', footprint: { width: 2, length: 2 }, iconKey: 'circle-table-4-chairs', defaultColor: '#FFFFFF', properties: { seats: 4 } },
  { name: 'Single Table with a Seat', category: 'surface', footprint: { width: 1, length: 1 }, iconKey: 'single-table-seat', defaultColor: '#FFFFFF', properties: { seats: 1 } },
  { name: 'Table with 2 Seats', category: 'surface', footprint: { width: 2, length: 1 }, iconKey: 'table-2-seats', defaultColor: '#FFFFFF', properties: { seats: 2 } },
  { name: 'Single Double Ladder Bed', category: 'sleeping', footprint: { width: 1, length: 2 }, iconKey: 'single-double-ladder-bed', defaultColor: '#FFFFFF', properties: {} },
  { name: 'Single Square Table with a Seat', category: 'surface', footprint: { width: 1, length: 1 }, iconKey: 'single-square-table-seat', defaultColor: '#FFFFFF', properties: { seats: 1 } },
];

async function addMissingCatalogItems() {
  const operations = ITEMS.map((item) => ({
    updateOne: {
      filter: { name: item.name },
      update: { $setOnInsert: item },
      upsert: true,
    },
  }));
  const result = await CatalogItem.bulkWrite(operations, { ordered: false });
  return result.upsertedCount || 0;
}

async function seed() {
  await connectDB();
  const added = await addMissingCatalogItems();
  console.log(`Added ${added} missing catalog items.`);
  process.exit(0);
}

async function ensureCatalog() {
  const added = await addMissingCatalogItems();
  if (added) console.log(`Added ${added} missing catalog items.`);
  return added > 0;
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { ensureCatalog };
