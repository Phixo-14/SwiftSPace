// Run with: npm run seed
// Adds starter furniture while preserving existing catalog items.
require('dotenv').config();
const connectDB = require('../config/db');
const CatalogItem = require('../models/CatalogItem');

const ITEMS = [
  { name: 'Platform Bed', category: 'sleeping', footprint: { width: 2, length: 3 }, iconKey: 'bed', defaultColor: '#E7E2D6', properties: {} },
  { name: 'Lounge Chair', category: 'seating', footprint: { width: 1, length: 1 }, iconKey: 'chairOne', defaultColor: '#C9C2B4', properties: {} },
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

// Additional catalog options use the existing category artwork and placement
// system, while offering practical size variants for common room layouts.
const CATALOG_GROUPS = [
  { category: 'sleeping', iconKey: 'bed', color: '#D9D0C0', items: [
    ['Twin Bed', 1, 2], ['Full Bed', 2, 2], ['Queen Bed', 2, 3], ['King Bed', 3, 3],
    ['Bunk Bed', 2, 3], ['Daybed', 2, 2], ['Crib', 1, 1], ['Futon', 2, 2],
    ['Canopy Bed', 3, 3], ['Trundle Bed', 2, 3],
  ] },
  { category: 'seating', iconKey: 'chair', color: '#A88F7A', items: [
    ['Loveseat Sofa', 2, 1], ['Three Seat Sofa', 3, 1], ['Sectional Sofa', 3, 2], ['Armchair', 1, 1],
    ['Accent Chair', 1, 1], ['Recliner', 1, 2], ['Storage Ottoman', 1, 1], ['Dining Chair', 1, 1],
    ['Bar Stool', 1, 1], ['Entry Bench', 2, 1],
  ] },
  { category: 'storage', iconKey: 'rack', color: '#9B8B73', items: [
    ['Wardrobe', 2, 1], ['Three Drawer Dresser', 2, 1], ['Six Drawer Dresser', 3, 1], ['Nightstand', 1, 1],
    ['Tall Cabinet', 1, 2], ['TV Console', 3, 1], ['Pantry Cabinet', 1, 2], ['Shoe Rack', 2, 1],
    ['Vanity Cabinet', 2, 1], ['Linen Cupboard', 1, 2],
  ] },
  { category: 'lighting', iconKey: 'lamp', color: '#E8D7A8', items: [
    ['Desk Lamp', 1, 1], ['Bedside Lamp', 1, 1], ['Arc Floor Lamp', 1, 1], ['Ceiling Light', 1, 1],
    ['Track Light', 2, 1], ['Wall Sconce', 1, 1], ['Paper Lantern', 1, 1], ['Chandelier', 2, 2],
    ['Task Lamp', 1, 1], ['Reading Floor Lamp', 1, 1],
  ] },
  { category: 'greenery', iconKey: 'plant', color: '#71866A', items: [
    ['Small Potted Plant', 1, 1], ['Succulent Pot', 1, 1], ['Tall Palm', 1, 1], ['Monstera Plant', 1, 1],
    ['Snake Plant', 1, 1], ['Rubber Tree', 1, 1], ['Fern Planter', 1, 1], ['Cactus Pot', 1, 1],
    ['Hanging Planter', 1, 1], ['Window Planter Box', 2, 1],
  ] },
  { category: 'surface', iconKey: 'desk', color: '#B29D7D', items: [
    ['Coffee Table', 2, 1], ['Narrow Console Table', 2, 1], ['Round Dining Table', 2, 2], ['Large Dining Table', 3, 2],
    ['Small Side Table', 1, 1], ['Bedside Table', 1, 1], ['Computer Desk', 2, 1], ['Corner Desk', 2, 2],
    ['Standing Desk', 2, 1], ['Makeup Vanity', 2, 1], ['Kitchen Island', 3, 1], ['Breakfast Bar', 3, 1],
    ['Worktable', 3, 2], ['Folding Table', 2, 1], ['Sofa Table', 2, 1], ['TV Tray Table', 1, 1],
    ['Craft Table', 2, 2], ['Library Table', 3, 1], ['Entry Console', 2, 1], ['Small Bistro Table', 1, 1],
  ] },
  { category: 'storage', iconKey: 'rack', color: '#8E806A', items: [
    ['Bookcase', 2, 1], ['Cube Organizer', 2, 1], ['Floating Shelf Unit', 2, 1], ['Corner Shelves', 1, 1],
    ['Storage Trunk', 2, 1], ['File Cabinet', 1, 1], ['Laundry Hamper', 1, 1], ['Coat Rack', 1, 1],
    ['Garage Shelving', 2, 2], ['Display Cabinet', 2, 1],
  ] },
];

const CATALOG_ART_BY_CATEGORY = {
  sleeping: ['bedOne', 'bed', 'bed', 'bed', 'single-double-ladder-bed', 'bedOne', 'bedOne', 'bedOne', 'bed', 'bed'],
  seating: ['sofaOne', 'sofaTwo', 'sofaSectional', 'armchair', 'chairFour', 'recliner', 'chairSeven', 'chairOne', 'chairEight', 'bench'],
  storage: ['cabinetFive', 'cabinetThree', 'cabinetFour', 'squareCabinet', 'cabinetFridge', 'counterFour', 'cabinetOne', 'counterOne', 'cabinetThree', 'cabinetFive'],
  lighting: ['lamp', 'lamp', 'lamp', 'lamp', 'lamp', 'lamp', 'lamp', 'lamp', 'lamp', 'lamp'],
  greenery: ['plant', 'plant', 'plant', 'plant', 'plant', 'plant', 'plant', 'plant', 'plant', 'plant'],
  surface: [
    'roundTable', 'counterOne', 'circle-table-4-chairs', 'rectangle-table-4-chairs', 'counterTwo',
    'counterThree', 'desk', 'counterFour', 'desk', 'counterOne', 'counterFour', 'counterFour',
    'counterFour', 'counterThree', 'counterTwo', 'counterOne', 'square-table-4-seats', 'counterFour',
    'counterTwo', 'roundTable',
  ],
};

const ADDITIONAL_ITEMS = CATALOG_GROUPS.flatMap(({ category, iconKey, color, items }) => (
  items.map(([name, width, length], index) => ({
    name,
    category,
    footprint: { width, length },
    iconKey: CATALOG_ART_BY_CATEGORY[category]?.[index] || iconKey,
    defaultColor: color,
    properties: {},
  }))
));
const ALL_ITEMS = [...ITEMS, ...ADDITIONAL_ITEMS];

async function addMissingCatalogItems() {
  const operations = ALL_ITEMS.map((item) => ({
    updateOne: {
      filter: { name: item.name },
      update: {
        $set: { iconKey: item.iconKey },
        $setOnInsert: Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'iconKey')),
      },
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
