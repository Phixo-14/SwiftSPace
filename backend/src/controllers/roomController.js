const Room = require('../models/Room');
const CatalogItem = require('../models/CatalogItem');
const RoomTimer = require('../models/RoomTimer');
const PlacementError = require('../models/PlacementError');

async function getRoomExtras(roomId) {
  const [timer, placementErrors] = await Promise.all([
    RoomTimer.findOne({ roomId }).select('seconds'),
    PlacementError.find({ roomId }).sort({ occurredAt: 1 }),
  ]);
  return {
    timerSeconds: timer?.seconds || 0,
    overlapRecords: placementErrors,
  };
}

async function saveRoomExtras(roomId, userId, timerSeconds, overlapRecords) {
  await RoomTimer.findOneAndUpdate(
    { roomId },
    { roomId, userId, seconds: timerSeconds },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await PlacementError.deleteMany({ roomId });
  if (overlapRecords.length) {
    await PlacementError.insertMany(overlapRecords.map((record) => ({
      ...record,
      roomId,
      userId,
      _id: undefined,
    })));
  }
}

// Confirms every placedItem sits fully inside the room's own width/length
// and references a catalog item that actually exists.
async function assertItemsFitAndExist(dimensions, placedItems) {
  if (!placedItems.length) return null;

  const ids = [...new Set(placedItems.map((i) => i.catalogItemId))];
  const found = await CatalogItem.find({ _id: { $in: ids } }).select('_id footprint');
  const catalogById = new Map(found.map((item) => [item._id.toString(), item]));
  const occupied = new Set();

  for (const item of placedItems) {
    const catalogItem = catalogById.get(item.catalogItemId.toString());
    if (!catalogItem) {
      return `catalogItemId ${item.catalogItemId} does not exist in the catalog.`;
    }

    for (let localY = 0; localY < catalogItem.footprint.width; localY += 1) {
      for (let localX = 0; localX < catalogItem.footprint.length; localX += 1) {
        let offsetX = localX;
        let offsetY = localY;
        for (let quarterTurn = 0; quarterTurn < item.rotation / 90; quarterTurn += 1) {
          [offsetX, offsetY] = [offsetY, -offsetX];
        }

        const x = item.gridX + offsetX;
        const y = item.gridY + offsetY;
        if (x < 0 || y < 0 || x >= dimensions.width || y >= dimensions.length) {
          return `Item at (${item.gridX}, ${item.gridY}) falls outside a ${dimensions.width}x${dimensions.length} room.`;
        }
        const cellKey = `${x},${y}`;
        if (occupied.has(cellKey)) {
          return `Furniture footprints overlap at (${x}, ${y}).`;
        }
        occupied.add(cellKey);
      }
    }
  }
  return null;
}

// GET /api/rooms
// Dashboard list view — uses projection so the (potentially large) placedItems
// array never crosses the wire just to render a list of room names/dates.
async function getRooms(req, res) {
  const rooms = await Room.find({ userId: req.user.id })
    .select('roomName dimensions createdAt updatedAt')
    .sort({ updatedAt: -1 });
  res.json(rooms);
}

// GET /api/rooms/:id
// Full document, including placedItems, for opening a room in the canvas.
async function getRoomById(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }
  const extras = await getRoomExtras(room._id);
  res.json({ ...room.toObject(), ...extras });
}

// POST /api/rooms
async function createRoom(req, res) {
  const { roomName, timerSeconds, dimensions, floorColor, gridColor, placedItems, overlapRecords } = req.body;

  const fitError = await assertItemsFitAndExist(dimensions, placedItems);
  if (fitError) return res.status(400).json({ message: fitError });

  const room = await Room.create({ userId: req.user.id, roomName, dimensions, floorColor, gridColor, placedItems });
  await saveRoomExtras(room._id, req.user.id, timerSeconds, overlapRecords);
  res.status(201).json({ ...room.toObject(), timerSeconds, overlapRecords });
}

// PUT /api/rooms/:id
async function updateRoom(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }

  const { roomName, timerSeconds, dimensions, floorColor, gridColor, placedItems, overlapRecords } = req.body;
  const fitError = await assertItemsFitAndExist(dimensions, placedItems);
  if (fitError) return res.status(400).json({ message: fitError });

  room.roomName = roomName;
  room.dimensions = dimensions;
  room.floorColor = floorColor;
  room.gridColor = gridColor;
  room.placedItems = placedItems;
  await room.save();
  await saveRoomExtras(room._id, req.user.id, timerSeconds, overlapRecords);

  res.json({ ...room.toObject(), timerSeconds, overlapRecords });
}

// DELETE /api/rooms/:id
async function deleteRoom(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }
  await Promise.all([
    room.deleteOne(),
    RoomTimer.deleteOne({ roomId: room._id }),
    PlacementError.deleteMany({ roomId: room._id }),
  ]);
  res.status(204).send();
}

module.exports = { getRooms, getRoomById, createRoom, updateRoom, deleteRoom };
