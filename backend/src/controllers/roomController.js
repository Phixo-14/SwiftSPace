const Room = require('../models/Room');
const CatalogItem = require('../models/CatalogItem');
const RoomTimer = require('../models/RoomTimer');
const PlacementError = require('../models/PlacementError');
const RoomVersion = require('../models/RoomVersion');
const FurnitureRotationAdjustment = require('../models/FurnitureRotationAdjustment');
const crypto = require('crypto');

function canUseArchitecturalTools(user) {
  return user?.role === 'interior-designer' || user?.role === 'admin';
}

function validateArchitecturalBounds(dimensions, segments, labels) {
  const segmentOutsideRoom = segments.some((segment) => (
    segment.startX > dimensions.width || segment.endX > dimensions.width
    || segment.startY > dimensions.length || segment.endY > dimensions.length
  ));
  if (segmentOutsideRoom) return 'A wall, door, or window must stay inside the room boundary.';

  const labelOutsideRoom = labels.some((label) => label.x >= dimensions.width || label.y >= dimensions.length);
  return labelOutsideRoom ? 'Room labels must stay inside the room boundary.' : null;
}

function createFullFloor(dimensions) {
  return Array.from({ length: dimensions.width * dimensions.length }, (_, index) => ({
    x: index % dimensions.width,
    y: Math.floor(index / dimensions.width),
  }));
}

function validateFloorShape(dimensions, floorCells) {
  if (!floorCells.length) return 'A room must contain at least one floor cell.';
  const floor = new Set(floorCells.map(({ x, y }) => `${x},${y}`));
  if (floor.size !== floorCells.length) return 'Room floor cells cannot contain duplicates.';
  if (floorCells.some(({ x, y }) => x < 0 || y < 0 || x >= dimensions.width || y >= dimensions.length)) {
    return 'Room floor cells must be inside the room dimensions.';
  }
  const pending = [floorCells[0]];
  const reached = new Set();
  while (pending.length) {
    const { x, y } = pending.pop();
    const key = `${x},${y}`;
    if (reached.has(key)) continue;
    reached.add(key);
    [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nextX, nextY]) => {
      const nextKey = `${nextX},${nextY}`;
      if (floor.has(nextKey) && !reached.has(nextKey)) pending.push({ x: nextX, y: nextY });
    });
  }
  return reached.size === floor.size ? null : 'Room floor cells must form one connected layout.';
}

function validateArchitectureOnFloor(floorCells, segments, labels) {
  const floor = new Set(floorCells.map(({ x, y }) => `${x},${y}`));
  const pointIsOnFloor = (x, y) => {
    const epsilon = 1e-7;
    for (let cellY = Math.floor(y) - 1; cellY <= Math.floor(y) + 1; cellY += 1) {
      for (let cellX = Math.floor(x) - 1; cellX <= Math.floor(x) + 1; cellX += 1) {
        if (floor.has(`${cellX},${cellY}`)
          && x >= cellX - epsilon && x <= cellX + 1 + epsilon
          && y >= cellY - epsilon && y <= cellY + 1 + epsilon) return true;
      }
    }
    return false;
  };

  for (const segment of segments) {
    const length = Math.hypot(segment.endX - segment.startX, segment.endY - segment.startY);
    const steps = Math.max(1, Math.ceil(length * 4));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const x = segment.startX + (segment.endX - segment.startX) * progress;
      const y = segment.startY + (segment.endY - segment.startY) * progress;
      if (!pointIsOnFloor(x, y)) {
        return `Placement error: ${segment.type} must stay on the room floor.`;
      }
    }
  }

  if (labels.some((label) => !floor.has(`${Math.floor(label.x)},${Math.floor(label.y)}`))) {
    return 'Placement error: room labels must be placed on the room floor.';
  }
  return null;
}

async function getRoomExtras(roomId) {
  const [timer, placementErrors] = await Promise.all([
    RoomTimer.findOne({ roomId }).select('seconds').lean(),
    PlacementError.find({ roomId }).sort({ occurredAt: 1 }).lean(),
  ]);
  return {
    timerSeconds: timer?.seconds || 0,
    overlapRecords: placementErrors,
  };
}

async function saveRoomExtras(roomId, userId, timerSeconds, overlapRecords) {
  const safeSeconds = Number.isFinite(Number(timerSeconds)) ? Number(timerSeconds) : 0;
  await RoomTimer.findOneAndUpdate(
    { roomId },
    { $set: { userId, seconds: safeSeconds } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await PlacementError.deleteMany({ roomId });
  const records = overlapRecords
    .filter((record) => record.catalogItemId && record.reason)
    .map((record) => ({
      catalogItemId: record.catalogItemId,
      gridX: record.gridX,
      gridY: record.gridY,
      rotation: record.rotation || 0,
      reason: record.reason,
      occurredAt: record.occurredAt,
      roomId,
      userId,
    }));
  if (records.length) await PlacementError.insertMany(records);
}

// Confirms every placedItem sits fully inside the room's own width/length
// and references a catalog item that actually exists.
async function assertItemsFitAndExist(dimensions, placedItems, architecturalSegments = [], floorCells = []) {
  if (!placedItems.length) return null;

  const validFloorCells = floorCells.length
    ? new Set(floorCells.map(({ x, y }) => `${x},${y}`))
    : null;
  const ids = [...new Set(placedItems.map((i) => i.catalogItemId))];
  const found = await CatalogItem.find({ _id: { $in: ids } }).select('_id footprint');
  const catalogById = new Map(found.map((item) => [item._id.toString(), item]));
  const placedBounds = [];
  const doors = architecturalSegments.filter((segment) => segment.type === 'door');
  const epsilon = 1e-9;

  for (const item of placedItems) {
    const catalogItem = catalogById.get(item.catalogItemId.toString());
    if (!catalogItem) {
      return `catalogItemId ${item.catalogItemId} does not exist in the catalog.`;
    }

    const radians = (item.rotation * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const footprintWidth = item.size?.width || catalogItem.footprint.width;
    const footprintLength = item.size?.length || catalogItem.footprint.length;
    const rotatedWidth = Math.max(0.25, footprintWidth * cosine + footprintLength * sine);
    const rotatedLength = Math.max(0.25, footprintWidth * sine + footprintLength * cosine);
    const bounds = {
      left: item.gridX,
      top: item.gridY,
      right: item.gridX + rotatedWidth,
      bottom: item.gridY + rotatedLength,
    };
    if (bounds.left < 0 || bounds.top < 0
      || bounds.right > dimensions.width + epsilon || bounds.bottom > dimensions.length + epsilon) {
      return `Item at (${item.gridX}, ${item.gridY}) falls outside a ${dimensions.width}x${dimensions.length} room.`;
    }
    if (placedBounds.some((other) => (
      bounds.left < other.right - epsilon && bounds.right > other.left + epsilon
      && bounds.top < other.bottom - epsilon && bounds.bottom > other.top + epsilon
    ))) {
      return `Furniture footprints overlap at (${item.gridX}, ${item.gridY}).`;
    }
    placedBounds.push(bounds);

    const minCellX = Math.floor(bounds.left);
    const minCellY = Math.floor(bounds.top);
    const maxCellX = Math.ceil(bounds.right - epsilon);
    const maxCellY = Math.ceil(bounds.bottom - epsilon);
    for (let y = minCellY; y < maxCellY; y += 1) {
      for (let x = minCellX; x < maxCellX; x += 1) {
        if (validFloorCells && !validFloorCells.has(`${x},${y}`)) {
          return `Item at (${x}, ${y}) falls outside the room floor.`;
        }
        const doorOverlap = doors.some((door) => {
          const minX = Math.min(door.startX, door.endX);
          const maxX = Math.max(door.startX, door.endX);
          const minY = Math.min(door.startY, door.endY);
          const maxY = Math.max(door.startY, door.endY);
          const horizontal = Math.abs(door.startY - door.endY) < epsilon;

          return horizontal
            ? door.startY >= bounds.top - epsilon && door.startY <= bounds.bottom + epsilon
              && maxX >= bounds.left - epsilon && minX <= bounds.right + epsilon
            : door.startX >= bounds.left - epsilon && door.startX <= bounds.right + epsilon
              && maxY >= bounds.top - epsilon && minY <= bounds.bottom + epsilon;
        });
        if (doorOverlap) return `Furniture at (${x}, ${y}) overlaps a door opening.`;
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
    .select('roomName clientName measurements dimensions folderId createdAt updatedAt')
    .sort({ updatedAt: -1 });

  const roomIds = rooms.map((room) => room._id);
  const timers = await RoomTimer.find({ roomId: { $in: roomIds } }).select('roomId seconds').lean();
  const timerByRoom = new Map(timers.map((timer) => [timer.roomId.toString(), Number(timer.seconds) || 0]));

  res.json(rooms.map((room) => ({
    ...room.toObject(),
    timerSeconds: timerByRoom.get(room._id.toString()) ?? 0,
  })));
}

// GET /api/rooms/:id
// Full document, including placedItems, for opening a room in the canvas.
async function getRoomById(req, res) {
  const room = await Room.findById(req.params.id).lean();
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }
  const placedItems = room.placedItems || [];
  if (placedItems.some((item) => !item.placementId)) {
    room.placedItems = placedItems.map((item) => ({
      ...item,
      placementId: item.placementId || crypto.randomUUID(),
    }));
    await Room.updateOne(
      { _id: room._id, userId: req.user.id },
      { $set: { placedItems: room.placedItems } }
    );
  }
  const extras = await getRoomExtras(room._id);
  if (!canUseArchitecturalTools(req.user)) {
    delete room.wallThicknessMm;
    delete room.architecturalSegments;
    delete room.roomLabels;
  }
  res.json({ ...room, ...extras });
}

// POST /api/rooms
async function createRoom(req, res) {
  const {
    roomName, clientName, measurements, designNotes, timerSeconds, dimensions,
    floorColor, gridColor, placedItems, overlapRecords, wallThicknessMm,
    architecturalSegments, roomLabels, floorCells,
  } = req.body;

  const roomFloorCells = floorCells?.length ? floorCells : createFullFloor(dimensions);
  const floorShapeError = validateFloorShape(dimensions, roomFloorCells);
  if (floorShapeError) return res.status(400).json({ message: floorShapeError });
  const fitError = await assertItemsFitAndExist(dimensions, placedItems, architecturalSegments || [], roomFloorCells);
  if (fitError) return res.status(400).json({ message: fitError });
  const designer = canUseArchitecturalTools(req.user);
  if (designer) {
    const architectureError = validateArchitecturalBounds(dimensions, architecturalSegments, roomLabels);
    if (architectureError) return res.status(400).json({ message: architectureError });
    const floorArchitectureError = validateArchitectureOnFloor(
      roomFloorCells,
      architecturalSegments,
      roomLabels
    );
    if (floorArchitectureError) return res.status(400).json({ message: floorArchitectureError });
  }

  const room = await Room.create({
    userId: req.user.id,
    roomName,
    clientName,
    measurements,
    designNotes,
    dimensions,
    floorCells: roomFloorCells,
    floorColor,
    gridColor,
    ...(designer ? { wallThicknessMm, architecturalSegments, roomLabels } : {}),
    placedItems,
  });
  const rotationAdjustments = placedItems
    .filter((item) => item.rotation !== 0)
    .map((item) => ({
      roomId: room._id,
      userId: req.user.id,
      placementId: item.placementId,
      catalogItemId: item.catalogItemId,
      fromDegrees: 0,
      toDegrees: item.rotation,
    }));
  if (rotationAdjustments.length) {
    try {
      await FurnitureRotationAdjustment.insertMany(rotationAdjustments);
    } catch (error) {
      console.error(`Rotation adjustment logging failed for ${room._id}:`, error);
    }
  }
  try {
    await saveRoomExtras(room._id, req.user.id, timerSeconds, overlapRecords);
  } catch (error) {
    console.error(`Room extras save failed for ${room._id}:`, error);
  }
  const response = room.toObject();
  if (!designer) {
    delete response.wallThicknessMm;
    delete response.architecturalSegments;
    delete response.roomLabels;
  }
  res.status(201).json({ ...response, timerSeconds, overlapRecords });
}

// PUT /api/rooms/:id
async function updateRoom(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }

  const {
    roomName, clientName, measurements, designNotes, timerSeconds, dimensions,
    floorColor, gridColor, placedItems, overlapRecords, wallThicknessMm,
    architecturalSegments, roomLabels, floorCells,
  } = req.body;
  const roomFloorCells = floorCells?.length ? floorCells : createFullFloor(dimensions);
  const floorShapeError = validateFloorShape(dimensions, roomFloorCells);
  if (floorShapeError) return res.status(400).json({ message: floorShapeError });
  const fitError = await assertItemsFitAndExist(dimensions, placedItems, architecturalSegments || [], roomFloorCells);
  if (fitError) return res.status(400).json({ message: fitError });
  const designer = canUseArchitecturalTools(req.user);
  if (designer) {
    const architectureError = validateArchitecturalBounds(dimensions, architecturalSegments, roomLabels);
    if (architectureError) return res.status(400).json({ message: architectureError });
    const floorArchitectureError = validateArchitectureOnFloor(
      roomFloorCells,
      architecturalSegments,
      roomLabels
    );
    if (floorArchitectureError) return res.status(400).json({ message: floorArchitectureError });
  }

  const previousPlacements = new Map(room.placedItems.map((item) => [item.placementId, item]));
  const rotationAdjustments = placedItems.flatMap((item) => {
    const previous = previousPlacements.get(item.placementId);
    if (!previous || previous.rotation === item.rotation) return [];
    return [{
      roomId: room._id,
      userId: req.user.id,
      placementId: item.placementId,
      catalogItemId: item.catalogItemId,
      fromDegrees: previous.rotation,
      toDegrees: item.rotation,
    }];
  });

  try {
    room.roomName = roomName;
    room.clientName = clientName;
    room.measurements = measurements;
    room.designNotes = designNotes;
    room.dimensions = dimensions;
    room.floorCells = roomFloorCells;
    room.floorColor = floorColor;
    room.gridColor = gridColor;
    if (designer) {
      room.wallThicknessMm = wallThicknessMm;
      room.architecturalSegments = architecturalSegments;
      room.roomLabels = roomLabels;
    }
    room.placedItems = placedItems;
    await room.save();
    await saveRoomExtras(room._id, req.user.id, timerSeconds, overlapRecords);
    if (rotationAdjustments.length) {
      try {
        await FurnitureRotationAdjustment.insertMany(rotationAdjustments);
      } catch (error) {
        console.error(`Rotation adjustment logging failed for ${room._id}:`, error);
      }
    }
    const response = room.toObject();
    if (!designer) {
      delete response.wallThicknessMm;
      delete response.architecturalSegments;
      delete response.roomLabels;
    }
    res.json({ ...response, timerSeconds, overlapRecords });
  } catch (error) {
    console.error(`Room save failed for ${room._id}:`, error);
    res.status(500).json({ message: `Could not save room: ${error.message}` });
  }
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
    RoomVersion.deleteMany({ roomId: room._id }),
    FurnitureRotationAdjustment.deleteMany({ roomId: room._id }),
  ]);
  res.status(204).send();
}

async function duplicateRoom(req, res) {
  const source = await Room.findById(req.params.id);
  if (!source) return res.status(404).json({ message: 'Project not found.' });
  if (source.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this project.' });
  }

  const duplicate = await Room.create({
    userId: req.user.id,
    folderId: source.folderId,
    roomName: `${source.roomName} (Copy)`.slice(0, 60),
    clientName: source.clientName,
    measurements: source.measurements,
    designNotes: source.designNotes,
    dimensions: source.dimensions,
    floorCells: source.floorCells?.length ? source.floorCells : createFullFloor(source.dimensions),
    floorColor: source.floorColor,
    gridColor: source.gridColor,
    wallThicknessMm: source.wallThicknessMm,
    architecturalSegments: source.architecturalSegments,
    roomLabels: source.roomLabels,
    placedItems: source.placedItems,
  });
  res.status(201).json({ ...duplicate.toObject(), timerSeconds: 0, overlapRecords: [] });
}

async function getRoomVersions(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Project not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this project.' });
  }

  const versions = await RoomVersion.find({ roomId: room._id, userId: req.user.id })
    .select('_id name createdAt')
    .sort({ createdAt: -1 });
  res.json(versions);
}

async function getRoomVersion(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Project not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this project.' });
  }

  const version = await RoomVersion.findOne({
    _id: req.params.versionId,
    roomId: room._id,
    userId: req.user.id,
  }).select('_id name createdAt snapshot').lean();
  if (!version) return res.status(404).json({ message: 'Project version not found.' });
  if (!canUseArchitecturalTools(req.user)) {
    delete version.snapshot.wallThicknessMm;
    delete version.snapshot.architecturalSegments;
    delete version.snapshot.roomLabels;
  }
  res.json(version);
}

async function createRoomVersion(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Project not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this project.' });
  }

  const extras = await getRoomExtras(room._id);
  const version = await RoomVersion.create({
    roomId: room._id,
    userId: req.user.id,
    name: req.body.name,
    snapshot: {
      roomName: room.roomName,
      clientName: room.clientName,
      measurements: room.measurements,
      designNotes: room.designNotes,
      dimensions: room.dimensions,
      floorCells: room.floorCells,
      floorColor: room.floorColor,
      gridColor: room.gridColor,
      ...(canUseArchitecturalTools(req.user) ? {
        wallThicknessMm: room.wallThicknessMm,
        architecturalSegments: room.architecturalSegments,
        roomLabels: room.roomLabels,
      } : {}),
      placedItems: room.placedItems,
      timerSeconds: extras.timerSeconds,
      overlapRecords: extras.overlapRecords,
    },
  });

  const expiredVersions = await RoomVersion.find({ roomId: room._id, userId: req.user.id })
    .sort({ createdAt: -1 })
    .skip(20)
    .select('_id')
    .lean();
  if (expiredVersions.length) {
    await RoomVersion.deleteMany({ _id: { $in: expiredVersions.map((savedVersion) => savedVersion._id) } });
  }
  res.status(201).json({ _id: version._id, name: version.name, createdAt: version.createdAt });
}

async function restoreRoomVersion(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Project not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this project.' });
  }

  const version = await RoomVersion.findOne({ _id: req.params.versionId, roomId: room._id, userId: req.user.id });
  if (!version) return res.status(404).json({ message: 'Project version not found.' });
  const snapshot = version.snapshot;
  const floorCells = snapshot.floorCells?.length
    ? snapshot.floorCells
    : createFullFloor(snapshot.dimensions);
  const floorShapeError = validateFloorShape(snapshot.dimensions, floorCells);
  if (floorShapeError) return res.status(400).json({ message: floorShapeError });
  if (canUseArchitecturalTools(req.user)) {
    const floorArchitectureError = validateArchitectureOnFloor(
      floorCells,
      snapshot.architecturalSegments || [],
      snapshot.roomLabels || []
    );
    if (floorArchitectureError) return res.status(400).json({ message: floorArchitectureError });
  }
  const fitError = await assertItemsFitAndExist(
    snapshot.dimensions,
    snapshot.placedItems,
    snapshot.architecturalSegments || [],
    floorCells,
  );
  if (fitError) return res.status(400).json({ message: fitError });

  room.roomName = snapshot.roomName;
  room.clientName = snapshot.clientName;
  room.measurements = snapshot.measurements;
  room.designNotes = snapshot.designNotes;
  room.dimensions = snapshot.dimensions;
  room.floorCells = floorCells;
  room.floorColor = snapshot.floorColor;
  room.gridColor = snapshot.gridColor;
  if (canUseArchitecturalTools(req.user)) {
    room.wallThicknessMm = snapshot.wallThicknessMm || 150;
    room.architecturalSegments = snapshot.architecturalSegments || [];
    room.roomLabels = snapshot.roomLabels || [];
  }
  room.placedItems = snapshot.placedItems;
  await room.save();
  await saveRoomExtras(room._id, req.user.id, snapshot.timerSeconds, snapshot.overlapRecords);
  const response = room.toObject();
  if (!canUseArchitecturalTools(req.user)) {
    delete response.wallThicknessMm;
    delete response.architecturalSegments;
    delete response.roomLabels;
  }
  res.json({ ...response, timerSeconds: snapshot.timerSeconds, overlapRecords: snapshot.overlapRecords });
}

async function createShareLink(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }

  if (!room.shareToken) {
    room.shareToken = crypto.randomBytes(32).toString('hex');
    await room.save();
  }
  res.json({ token: room.shareToken });
}

async function revokeShareLink(req, res) {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'You do not have access to this room.' });
  }

  if (room.shareToken) {
    room.shareToken = undefined;
    await room.save();
  }
  res.status(204).send();
}

async function getSharedRoom(req, res) {
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) {
    return res.status(404).json({ message: 'Shared room not found or link revoked.' });
  }
  const room = await Room.findOne({ shareToken: req.params.token })
    .select('roomName dimensions floorCells floorColor gridColor placedItems')
    .populate('placedItems.catalogItemId', 'name category footprint iconKey defaultColor');
  if (!room) return res.status(404).json({ message: 'Shared room not found or link revoked.' });
  res.json(room);
}

module.exports = {
  getRooms,
  getRoomById,
  createRoom,
  updateRoom,
  deleteRoom,
  duplicateRoom,
  getRoomVersions,
  getRoomVersion,
  createRoomVersion,
  restoreRoomVersion,
  createShareLink,
  revokeShareLink,
  getSharedRoom,
};
