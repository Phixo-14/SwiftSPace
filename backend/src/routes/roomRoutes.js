const express = require('express');
const { requireAuth, requireDesigner } = require('../middleware/auth');
const { validateBody, roomSchema, roomVersionSchema } = require('../middleware/validators');
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
