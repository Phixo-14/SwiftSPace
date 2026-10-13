const express = require('express');
const Joi = require('joi');
const { register, login, adminLogin, firebaseSync, deleteFirebaseUser, deleteAccount, syncFirebaseUsers, createAdmin, createUser, deleteUser, updateUserRole, verifyEmail, resendVerification, getAdminOverview, startMfaSetup, verifyMfaSetup, disableMfa, verifyMfaLogin } = require('../controllers/authController');
const { getSystemLogs } = require('../controllers/systemLogController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateBody, registerSchema, loginSchema, verificationSchema, emailSchema, firebaseSyncSchema, firebaseDeleteSchema, accountDeleteSchema, adminSchema, userRoleSchema, mfaSchema } = require('../middleware/validators');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/register', validateBody(registerSchema), register);
router.post('/login', loginLimiter, validateBody(loginSchema), login);
router.post('/login/mfa', loginLimiter, validateBody(loginSchema.keys({ code: Joi.string().pattern(/^\d{6}$/).required() })), verifyMfaLogin);
router.post('/admin-login', loginLimiter, validateBody(loginSchema), adminLogin);
router.post('/firebase-sync', validateBody(firebaseSyncSchema), firebaseSync);
router.post('/firebase-user-deleted', validateBody(firebaseDeleteSchema), deleteFirebaseUser);
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
router.delete('/account', requireAuth, validateBody(accountDeleteSchema), deleteAccount);
router.post('/admin/sync-firebase-users', requireAuth, requireAdmin, syncFirebaseUsers);
router.post('/verify-email', validateBody(verificationSchema), verifyEmail);
router.post('/resend-verification', validateBody(emailSchema), resendVerification);
router.post('/mfa/setup', requireAuth, validateBody(mfaSchema), startMfaSetup);
router.post('/mfa/verify', requireAuth, validateBody(mfaSchema), verifyMfaSetup);
router.post('/mfa/disable', requireAuth, validateBody(mfaSchema), disableMfa);
router.post('/admins', requireAuth, requireAdmin, validateBody(adminSchema), createAdmin);
router.post('/users', requireAuth, requireAdmin, validateBody(registerSchema), createUser);
router.patch('/users/:id/role', requireAuth, requireAdmin, validateBody(userRoleSchema), updateUserRole);
router.delete('/users/:id', requireAuth, requireAdmin, deleteUser);
router.get('/admin/overview', requireAuth, requireAdmin, getAdminOverview);
router.get('/admin/logs', requireAuth, requireAdmin, getSystemLogs);

module.exports = router;
