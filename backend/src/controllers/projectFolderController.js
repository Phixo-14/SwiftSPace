const ProjectFolder = require('../models/ProjectFolder');
const Room = require('../models/Room');

async function getFolders(req, res) {
  const folders = await ProjectFolder.find({ userId: req.user.id }).sort({ name: 1 }).lean();
  res.json(folders);
}

async function createFolder(req, res) {
  const normalizedName = req.body.name.toLocaleLowerCase();
  const existing = await ProjectFolder.exists({ userId: req.user.id, normalizedName });
  if (existing) return res.status(409).json({ message: 'A folder with that name already exists.' });

  try {
    const folder = await ProjectFolder.create({ userId: req.user.id, name: req.body.name, normalizedName });
    res.status(201).json(folder);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A folder with that name already exists.' });
    throw error;
  }
}

async function renameFolder(req, res) {
  const folder = await ProjectFolder.findOne({ _id: req.params.folderId, userId: req.user.id });
  if (!folder) return res.status(404).json({ message: 'Folder not found.' });

  const normalizedName = req.body.name.toLocaleLowerCase();
  const duplicate = await ProjectFolder.exists({
    userId: req.user.id,
    normalizedName,
    _id: { $ne: folder._id },
  });
  if (duplicate) return res.status(409).json({ message: 'A folder with that name already exists.' });

  folder.name = req.body.name;
  folder.normalizedName = normalizedName;
  try {
    await folder.save();
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A folder with that name already exists.' });
    throw error;
  }
  res.json(folder);
}

async function deleteFolder(req, res) {
  const folder = await ProjectFolder.findOneAndDelete({ _id: req.params.folderId, userId: req.user.id });
  if (!folder) return res.status(404).json({ message: 'Folder not found.' });
  await Room.updateMany(
    { userId: req.user.id, folderId: folder._id },
    { $set: { folderId: null } }
  );
  res.status(204).send();
}

async function moveRoomToFolder(req, res) {
  const room = await Room.findOne({ _id: req.params.id, userId: req.user.id });
  if (!room) return res.status(404).json({ message: 'Project not found.' });

  let folder = null;
  if (req.body.folderId) {
    folder = await ProjectFolder.findOne({ _id: req.body.folderId, userId: req.user.id });
    if (!folder) return res.status(404).json({ message: 'Folder not found.' });
  }

  room.folderId = folder?._id || null;
  await room.save();
  res.json({ roomId: room._id, folderId: room.folderId });
}

module.exports = { getFolders, createFolder, renameFolder, deleteFolder, moveRoomToFolder };