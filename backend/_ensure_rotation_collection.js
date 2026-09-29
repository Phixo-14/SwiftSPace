'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const dns = require('dns');
const mongoose = require('mongoose');
const FurnitureRotationAdjustment = require('./src/models/FurnitureRotationAdjustment');

const dnsServers = (process.env.MONGO_DNS_SERVERS || '1.1.1.1,8.8.8.8')
  .split(',')
  .map((server) => server.trim())
  .filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  if (mongoose.connection.name !== 'swiftspace') {
    throw new Error(`Expected swiftspace database, got ${mongoose.connection.name || 'unknown'}.`);
  }

  const collection = FurnitureRotationAdjustment.collection.collectionName;
  try {
    await FurnitureRotationAdjustment.createCollection();
  } catch (error) {
    if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
  }
  await FurnitureRotationAdjustment.createIndexes();
  const indexes = await FurnitureRotationAdjustment.listIndexes();
  const records = await FurnitureRotationAdjustment.countDocuments();
  console.log(JSON.stringify({
    database: mongoose.connection.name,
    collection,
    records,
    indexes: indexes.map(({ name, key }) => ({ name, key })),
  }));
}

main()
  .catch((error) => {
    console.error(`Could not initialize rotation collection: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
