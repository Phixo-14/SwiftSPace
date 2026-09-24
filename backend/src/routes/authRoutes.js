const express = require('express');
const { register, login, firebaseSync, syncFirebaseUsers, createAdmin, createUser, deleteUser, verifyEmail, resendVerification, getAdminOverview } = require('../controllers/authController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateBody, registerSchema, loginSchema, verificationSchema, emailSchema, firebaseSyncSchema, adminSchema } = require('../middleware/validators');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/register', validateBody(registerSchema), register);
router.post('/login', loginLimiter, validateBody(loginSchema), login);
router.post('/firebase-sync', validateBody(firebaseSyncSchema), firebaseSync);
router.post('/admin/sync-firebase-users', requireAuth, requireAdmin, syncFirebaseUsers);
router.post('/verify-email', validateBody(verificationSchema), verifyEmail);
router.post('/resend-verification', validateBody(emailSchema), resendVerification);
router.post('/admins', requireAuth, requireAdmin, validateBody(adminSchema), createAdmin);
router.post('/users', requireAuth, requireAdmin, validateBody(registerSchema), createUser);
router.delete('/users/:id', requireAuth, requireAdmin, deleteUser);
router.get('/admin/overview', requireAuth, requireAdmin, getAdminOverview);

module.exports = router;
