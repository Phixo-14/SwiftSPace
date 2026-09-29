const express = require('express');
const { requireAuth, requireDesigner } = require('../middleware/auth');
const { validateBody, projectFolderSchema, roomFolderSchema, roomSchema, roomVersionSchema } = require('../middleware/validators');
const {
  getFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  moveRoomToFolder,
} = require('../controllers/projectFolderController');
const {
  getRooms,
  getRoomById,
  createRoom,
  updateRoom,
  deleteRoom,
  duplicateRoom,
  getRoomVersions,
  createRoomVersion,
  restoreRoomVersion,
  createShareLink,
  revokeShareLink,
} = require('../controllers/roomController');

const router = express.Router();

// Every /api/rooms route requires a logged-in user.
router.use(requireAuth);

router.get('/folders', requireDesigner, getFolders);
router.post('/folders', requireDesigner, validateBody(projectFolderSchema), createFolder);
router.patch('/folders/:folderId', requireDesigner, validateBody(projectFolderSchema), renameFolder);
router.delete('/folders/:folderId', requireDesigner, deleteFolder);
router.patch('/:id/folder', requireDesigner, validateBody(roomFolderSchema), moveRoomToFolder);
router.get('/', getRooms);
router.get('/:id', getRoomById);
router.post('/', validateBody(roomSchema), createRoom);
router.put('/:id', validateBody(roomSchema), updateRoom);
router.delete('/:id', deleteRoom);
router.post('/:id/duplicate', requireDesigner, duplicateRoom);
router.get('/:id/versions', requireDesigner, getRoomVersions);
router.post('/:id/versions', requireDesigner, validateBody(roomVersionSchema), createRoomVersion);
router.post('/:id/versions/:versionId/restore', requireDesigner, restoreRoomVersion);
router.post('/:id/share', createShareLink);
router.delete('/:id/share', revokeShareLink);

module.exports = router;
