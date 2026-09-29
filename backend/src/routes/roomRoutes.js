const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateBody, roomSchema } = require('../middleware/validators');
const {
  getRooms,
  getRoomById,
  createRoom,
  updateRoom,
  deleteRoom,
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
router.post('/:id/share', createShareLink);
router.delete('/:id/share', revokeShareLink);

module.exports = router;
