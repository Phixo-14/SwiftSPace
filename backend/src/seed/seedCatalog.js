// Run with: npm run seed
// Wipes and re-populates the catalog collection with a small, minimalist
// starter set so the frontend has something to render immediately.
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
];

async function seed() {
  await connectDB();
  await CatalogItem.deleteMany({});
  const created = await CatalogItem.insertMany(ITEMS);
  console.log(`Seeded ${created.length} catalog items.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
