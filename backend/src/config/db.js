const mongoose = require('mongoose');
const dns = require('dns');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and configure it.');
  }
  mongoose.set('strictQuery', true);
  const dnsServers = (process.env.MONGO_DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);
  await mongoose.connect(uri);
  await ensureCollections();
  console.log(`MongoDB connected -> ${mongoose.connection.host}/${mongoose.connection.name}`);
}

async function ensureCollections() {
  const models = mongoose.modelNames().map((modelName) => mongoose.model(modelName));
  const existingCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const existingNames = new Set(existingCollections.map(({ name }) => name));
  const missingModels = models.filter((model) => !existingNames.has(model.collection.name));

  await Promise.all(missingModels.map((model) => model.createCollection()));
  console.log(`MongoDB collections verified: ${models.map((model) => model.collection.name).join(', ')}`);
  if (missingModels.length) {
    console.warn(`Recreated missing collections: ${missingModels.map((model) => model.collection.name).join(', ')}`);
  }
}

module.exports = connectDB;
