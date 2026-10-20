const mongoose = require('mongoose');
const dns = require('dns');
const User = require('../models/User');
const RoomTimer = require('../models/RoomTimer');
const PlacementError = require('../models/PlacementError');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and configure it.');
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new Error('MONGO_URI must start with mongodb:// or mongodb+srv://. Check backend/.env.');
  }

  mongoose.set('strictQuery', true);
  const dnsServers = (process.env.MONGO_DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      retryWrites: true,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/bad auth|authentication failed/i.test(message)) {
      throw new Error(
        'MongoDB authentication failed. Check the username/password in backend/.env MONGO_URI, then verify the database user is allowed and the current IP is whitelisted in MongoDB Atlas.'
      );
    }
    throw error;
  }

  await migrateLegacyCollections();
  await ensureCollections();
  await removeUniqueUsernameIndex();
  console.log(`MongoDB connected -> ${mongoose.connection.host}/${mongoose.connection.name}`);
}

async function removeUniqueUsernameIndex() {
  const indexes = await User.collection.indexes();
  const uniqueUsernameIndexes = indexes.filter((index) => (
    index.unique === true
    && index.key?.username === 1
    && Object.keys(index.key).length === 1
  ));
  for (const index of uniqueUsernameIndexes) {
    await User.collection.dropIndex(index.name);
    console.log(`Removed unique username index: ${index.name}`);
  }
}

async function migrateLegacyCollections() {
  const roomsCollection = mongoose.connection.db.collection('rooms');
  const legacyRooms = await roomsCollection.find({
    $or: [{ timerSeconds: { $exists: true } }, { overlapRecords: { $exists: true } }],
  }).toArray();

  for (const room of legacyRooms) {
    if (typeof room.timerSeconds === 'number') {
      await RoomTimer.updateOne(
        { roomId: room._id },
        { $setOnInsert: { roomId: room._id, userId: room.userId, seconds: room.timerSeconds } },
        { upsert: true }
      );
    }
    if (room.overlapRecords?.length) {
      const existingCount = await PlacementError.countDocuments({ roomId: room._id });
      if (!existingCount) {
        await PlacementError.insertMany(room.overlapRecords.map((record) => ({
          roomId: room._id,
          userId: room.userId,
          catalogItemId: record.catalogItemId,
          gridX: record.gridX,
          gridY: record.gridY,
          rotation: record.rotation,
          reason: record.reason,
          occurredAt: record.occurredAt,
        })));
      }
    }
    await roomsCollection.updateOne(
      { _id: room._id },
      { $unset: { timerSeconds: '', overlapRecords: '' } }
    );
  }

  const pendingUsersCollection = mongoose.connection.db.collection('pendingusers');
  const pendingUsers = await pendingUsersCollection.find({}).toArray();
  for (const pending of pendingUsers) {
    const existingUser = await User.exists({ email: pending.email });
    if (!existingUser) {
      await User.create({
        username: pending.username,
        email: pending.email,
        passwordHash: pending.passwordHash,
        emailVerified: false,
        emailVerificationCodeHash: pending.verificationCodeHash,
        emailVerificationExpiresAt: pending.verificationExpiresAt,
      });
    }
  }
  const legacyCollectionNames = await mongoose.connection.db
    .listCollections({ name: 'pendingusers' }, { nameOnly: true })
    .toArray();
  if (legacyCollectionNames.length) await pendingUsersCollection.drop();
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
