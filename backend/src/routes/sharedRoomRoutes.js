const express = require('express');
const { getSharedRoom } = require('../controllers/roomController');

const router = express.Router();

router.get('/:token', getSharedRoom);

module.exports = router;