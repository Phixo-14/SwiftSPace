const CatalogItem = require('../models/CatalogItem');

// GET /api/catalog/items
// Populates the frontend placement side-panel with every available asset.
async function getItems(req, res) {
  const items = await CatalogItem.find().sort({ category: 1, name: 1 });
  res.json(items);
}

module.exports = { getItems };
