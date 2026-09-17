const express = require('express');
const { register, login } = require('../controllers/authController');
const { validateBody, registerSchema, loginSchema } = require('../middleware/validators');

const router = express.Router();

router.post('/register', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), login);

module.exports = router;
